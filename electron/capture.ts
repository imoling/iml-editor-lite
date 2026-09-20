import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import fs from 'fs';
import path from 'path';
import { appendCapture, DEFAULT_CAPTURE_SHORTCUT } from './shared/capture';
import { DAILY_DIR, TEMPLATE_DIR, DEFAULT_DAILY_TEMPLATE, renderNoteTemplate } from './shared/noteTemplates';
import { formatDate } from './shared/date';
import type { NoteHistory } from './history';

/**
 * 快速捕获：在任何软件里按全局快捷键，弹一个小输入框，回车把这句话追加到今天的日记末尾。
 *
 * - 小窗口在 mac 上是 panel（不激活应用）：记完收起，焦点回到用户原来的软件，编辑器不会跳到前面。
 * - 写入优先交给主窗口的渲染层：今天的日记可能正开着、还有没存盘的改动，直接写盘会和它打架。
 *   主窗口不在（mac 上窗口全关了）或几秒内没回音，主进程自己写盘。
 */
export interface QuickCaptureSettings { enabled: boolean; shortcut: string }
export interface QuickCaptureStatus extends QuickCaptureSettings {
  /** 快捷键有没有注册上；没注册上多半是被别的应用占了 */
  registered: boolean;
}

interface Deps {
  getSettings: () => { quickCapture?: Partial<QuickCaptureSettings>; defaultLibraryPath?: string };
  getMainWindow: () => BrowserWindow | null;
  history?: NoteHistory;
  /** 冒烟测试（IML_SMOKE_OFFSCREEN）：小窗口离屏渲染、不真的弹出来——它置顶又抢键盘焦点，弹出来会截走用户正在别处打的字 */
  smokeHidden?: boolean;
}

const WIDTH = 560;
const HEIGHT = 132;

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root{color-scheme:light dark;--bg:#fff;--ink:#1d1d1f;--sub:#8e8e93;--line:rgba(0,0,0,.12)}
@media(prefers-color-scheme:dark){:root{--bg:#2c2c2e;--ink:#f5f5f7;--sub:#98989d;--line:rgba(255,255,255,.14)}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.box{height:100%;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:14px;overflow:hidden;-webkit-app-region:drag}
textarea{flex:1;border:0;outline:0;resize:none;background:transparent;color:var(--ink);font:15px/1.6 inherit;font-family:inherit;padding:14px 16px 4px;-webkit-app-region:no-drag}
textarea::placeholder{color:var(--sub)}
.foot{display:flex;gap:12px;padding:0 16px 10px;font-size:11px;color:var(--sub)}.foot b{font-weight:500}.foot .msg{margin-left:auto}.foot .err{color:#ff453a}
</style></head><body><div class="box"><textarea id="t" placeholder="记一句话，存进今天的日记…" spellcheck="false"></textarea>
<div class="foot"><span><b>↵</b> 保存</span><span><b>⇧↵</b> 换行</span><span><b>Esc</b> 关闭</span><span class="msg" id="m"></span></div></div>
<script>
const t=document.getElementById('t'),m=document.getElementById('m');let busy=false;
const say=(text,err)=>{m.textContent=text;m.className='msg'+(err?' err':'')};
window.capture.onShow(()=>{say('');t.focus();});
t.addEventListener('keydown',async(e)=>{
  if(e.isComposing||e.keyCode===229)return;
  if(e.key==='Escape'){e.preventDefault();window.capture.close();return;}
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(busy||!t.value.trim())return;busy=true;say('正在保存…');
    const r=await window.capture.submit(t.value).catch((x)=>({ok:false,error:String(x)}));busy=false;
    if(r&&r.ok){t.value='';say('');window.capture.close();}else say((r&&r.error)||'没存上，再试一次',true);}
});
</script></body></html>`;

export function readQuickCapture(settings: { quickCapture?: Partial<QuickCaptureSettings> }): QuickCaptureSettings {
  const q = settings.quickCapture || {};
  return { enabled: q.enabled !== false, shortcut: typeof q.shortcut === 'string' && q.shortcut.trim() ? q.shortcut.trim() : DEFAULT_CAPTURE_SHORTCUT };
}

/** 主窗口不在时用的写盘路径：建目录、按模板建今天的日记、追加、留版本历史 */
export async function captureToDisk(libraryPath: string, text: string, now: Date, history?: NoteHistory): Promise<string> {
  const dir = path.join(libraryPath, DAILY_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  const day = formatDate(now);
  const file = path.join(dir, `${day}.md`);
  let content: string;
  try {
    content = await fs.promises.readFile(file, 'utf8');
  } catch {
    let template = DEFAULT_DAILY_TEMPLATE;
    try { template = (await fs.promises.readFile(path.join(libraryPath, TEMPLATE_DIR, '日记.md'), 'utf8')) || template; } catch { /* 没有自定义模板 */ }
    content = renderNoteTemplate(template, { title: day, date: now });
  }
  const next = appendCapture(content, text, now);
  if (next === null) throw new Error('内容是空的');
  await history?.beforeOverwrite(file, next).catch(() => {});
  await fs.promises.writeFile(file, next, 'utf8');
  await history?.record(file, next, 'save').catch(() => {});
  return file;
}

export function setupQuickCapture(deps: Deps) {
  let win: BrowserWindow | null = null;
  let registered = false;
  let current = '';
  let seq = 0;

  const hide = () => { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); };

  const show = () => {
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width: WIDTH, height: HEIGHT, show: false, frame: false, transparent: true, resizable: false, movable: true,
        minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
        // mac：panel 不激活应用，收起后焦点回到用户原来的软件
        ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
        webPreferences: { preload: path.join(__dirname, 'capturePreload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: !!deps.smokeHidden },
      });
      win.setAlwaysOnTop(true, 'floating');
      // 跟着用户到当前桌面、盖在全屏应用上面。skipTransformProcessType 不能省：
      // 这个调用默认会在 macOS 上「变换进程类型」（UIElement ⇄ Foreground），实测应用会在大约 30 秒后收到系统发来的 SIGTERM、整个退出，
      // 文档里也写了它会让窗口和 Dock 图标闪一下。我们只要「所有桌面可见」，不需要换进程类型
      if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      win.on('blur', hide);
      win.webContents.on('will-navigate', (e) => e.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
    }
    // 出现在鼠标所在的那块屏幕上，偏上三分之一处
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    win.setBounds({ x: Math.round(area.x + (area.width - WIDTH) / 2), y: Math.round(area.y + area.height * 0.28), width: WIDTH, height: HEIGHT });
    const reveal = () => {
      if (!win || win.isDestroyed()) return;
      if (!deps.smokeHidden) { win.show(); win.focus(); }
      win.webContents.send('capture:shown');
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal); else reveal();
  };

  const toggle = () => { if (win && !win.isDestroyed() && win.isVisible()) hide(); else show(); };

  const apply = (): QuickCaptureStatus => {
    const want = readQuickCapture(deps.getSettings());
    if (current) { try { globalShortcut.unregister(current); } catch { /* 写法不合法的注销不掉，无妨 */ } current = ''; registered = false; }
    if (want.enabled) {
      try { registered = globalShortcut.register(want.shortcut, toggle); } catch { registered = false; }
      if (registered) current = want.shortcut;
    }
    return { ...want, registered };
  };

  /** 交给主窗口的渲染层去写；它不在、或 4 秒没回音，返回 null 让调用方自己写盘 */
  const viaRenderer = (text: string): Promise<{ ok: boolean; error?: string } | null> => new Promise((resolve) => {
    const main = deps.getMainWindow();
    if (!main || main.isDestroyed() || main.webContents.isLoading() || main.webContents.isCrashed()) { resolve(null); return; }
    const id = ++seq;
    const channel = 'capture:appended';
    const timer = setTimeout(() => { ipcMain.removeListener(channel, onReply); resolve(null); }, 4000);
    const onReply = (_e: Electron.IpcMainEvent, reply: { id: number; ok: boolean; error?: string }) => {
      if (!reply || reply.id !== id) return;
      clearTimeout(timer);
      ipcMain.removeListener(channel, onReply);
      resolve({ ok: !!reply.ok, error: reply.error });
    };
    ipcMain.on(channel, onReply);
    main.webContents.send('capture:append', { id, text });
  });

  ipcMain.handle('capture:submit', async (_event, raw: string) => {
    const text = String(raw || '');
    if (!text.trim()) return { ok: false, error: '内容是空的' };
    const handled = await viaRenderer(text);
    if (handled) return handled;
    const library = deps.getSettings().defaultLibraryPath;
    if (!library) return { ok: false, error: '还没有设置笔记库' };
    try {
      await captureToDisk(library, text, new Date(), deps.history);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: `写入失败：${err?.message || err}` };
    }
  });
  ipcMain.on('capture:close', hide);
  ipcMain.handle('capture:status', (): QuickCaptureStatus => ({ ...readQuickCapture(deps.getSettings()), registered }));
  ipcMain.handle('capture:show', () => { show(); return true; });

  apply();
  return { apply, dispose: () => { if (current) globalShortcut.unregister(current); if (win && !win.isDestroyed()) win.destroy(); } };
}
