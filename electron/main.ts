import { app, BrowserWindow, ipcMain, nativeImage, Menu, shell, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { setupFileSystemIPC } from './ipc/fileSystem';
import { SearchIndex } from './searchIndex';
import { setupLocalModel, ensureBuiltinEndpoint, isBuiltinService } from './localModel';

const isDev = process.env.NODE_ENV === 'development';

// macOS 菜单栏 App 名称来自 app.getName()，必须在 ready 前设置
app.name = 'iML Markdown Editor';
app.setName('iML Markdown Editor');

// 冒烟测试：IML_SMOKE_USERDATA 指向临时目录，配置 / 运行时 / 模型都不碰用户的真实数据
if (isDev && process.env.IML_SMOKE_USERDATA) app.setPath('userData', process.env.IML_SMOKE_USERDATA);

// ── Node.js 原生 HTTP helpers（不经过 Chromium WebIDL，不校验 ByteString）──────
function nodePost(
  url: string,
  body: string | Buffer,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': bodyBuf.length },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function nodeGetBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    mod.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return nodeGetBuffer(res.headers.location).then(resolve, reject);
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// Simple file-based store - defer initialization
let _userDataPath: string;
let _configPath: string;

function getPaths() {
  if (!_userDataPath) {
    _userDataPath = app.getPath('userData');
    _configPath = path.join(_userDataPath, 'ai-config.json');
  }
  return { userDataPath: _userDataPath, configPath: _configPath };
}

// ── 敏感字段落盘加密：macOS 走钥匙串、Windows 走 DPAPI（Electron safeStorage）──
// 磁盘上只存 <field>Enc（base64 密文）；读出来时还原成明文给渲染进程用。老配置里的明文在下次保存时自动转成密文。
const SECRET_SUFFIX = 'Enc';

function encryptSecrets(obj: any, fields: string[]) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (typeof value === 'string' && value && safeStorage.isEncryptionAvailable()) {
      out[field + SECRET_SUFFIX] = safeStorage.encryptString(value).toString('base64');
      delete out[field];
    } else if (!value) {
      delete out[field];
      delete out[field + SECRET_SUFFIX];
    }
  }
  return out;
}

function decryptSecrets(obj: any, fields: string[]) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const field of fields) {
    const enc = out[field + SECRET_SUFFIX];
    if (typeof enc === 'string' && enc) {
      try {
        out[field] = safeStorage.decryptString(Buffer.from(enc, 'base64'));
      } catch (err) {
        console.warn(`[safeStorage] 无法解密 ${field}，需要重新填写`, err);
        out[field] = '';
      }
      delete out[field + SECRET_SUFFIX];
    }
  }
  return out;
}

const AI_CONFIG_SECRETS = ['apiKey', 'searchApiKey'];

function getConfig() {
  const { configPath } = getPaths();
  try {
    if (fs.existsSync(configPath)) {
      return decryptSecrets(JSON.parse(fs.readFileSync(configPath, 'utf8')), AI_CONFIG_SECRETS);
    }
  } catch (err) {
    console.error('Failed to read config:', err);
  }
  return {};
}

function saveConfig(config: any) {
  const { configPath } = getPaths();
  try {
    fs.writeFileSync(configPath, JSON.stringify(encryptSecrets(config, AI_CONFIG_SECRETS), null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save config:', err);
    return { success: false, error: '写入文件失败' };
  }
}

function getAppSettings() {
  const { userDataPath } = getPaths();
  const settingsPath = path.join(userDataPath, 'app-settings.json');
  let settings: any = {
    appearanceMode: 'light',
    startupBehavior: 'restore',
    autoSave: true
  };
  
  try {
    if (fs.existsSync(settingsPath)) {
      settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
      if (settings.imageGenConfig) settings.imageGenConfig = decryptSecrets(settings.imageGenConfig, ['apiKey']);
    }
  } catch (err) {
    console.error('Failed to read settings:', err);
  }

  // 冒烟测试：IML_SMOKE_LIBRARY 指向一个临时笔记库，不碰用户真实设置
  if (isDev && process.env.IML_SMOKE_LIBRARY) settings.defaultLibraryPath = process.env.IML_SMOKE_LIBRARY;

  if (!settings.defaultLibraryPath) {
    try {
      const defaultLib = path.join(app.getPath('documents'), 'iML Notes');
      if (!fs.existsSync(defaultLib)) {
        fs.mkdirSync(defaultLib, { recursive: true });
      }
      settings.defaultLibraryPath = defaultLib;
    } catch (e) {
      console.error('Failed to init default library path:', e);
    }
  }

  return settings;
}

function saveAppSettings(settings: any) {
  const { userDataPath } = getPaths();
  const settingsPath = path.join(userDataPath, 'app-settings.json');
  try {
    const toWrite = settings?.imageGenConfig
      ? { ...settings, imageGenConfig: encryptSecrets(settings.imageGenConfig, ['apiKey']) }
      : settings;
    fs.writeFileSync(settingsPath, JSON.stringify(toWrite, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save settings:', err);
    return { success: false, error: '写入设置失败' };
  }
}

// Global state
let mainWindow: BrowserWindow | null = null;
// 通过「打开方式」/ 命令行传入、等待渲染进程拉取的文件路径队列
const pendingOpenFiles: string[] = [];

function isOpenableDocument(p: string): boolean {
  return /\.(md|markdown|mdown|mkd|txt)$/i.test(p) && fs.existsSync(p);
}

/** 从命令行参数里找出要打开的文档；相对路径按启动时的工作目录解析 */
function documentFromArgv(argv: string[], cwd: string): string | undefined {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-'))
    .map((a) => path.resolve(cwd, a))
    .find(isOpenableDocument);
}

/**
 * 把系统传入的文件交给渲染进程。只走一条路：入队，再发一个不带参数的 'open-file' 提醒；
 * 渲染进程在初始化完成和收到提醒时都会主动拉取队列。
 * 不依赖「渲染进程是否已注册监听」之类的状态位，页面刷新、初始化异常等情况下文件也不会丢。
 */
function openFileFromOS(filePath: string) {
  pendingOpenFiles.push(filePath);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('open-file');
  } else if (app.isReady()) {
    // macOS 下所有窗口关闭后应用仍驻留；此时双击文件必须重新建窗口，否则「能启动却不显示」
    createWindow();
  }
}

// 版本号与待打开文件队列不依赖 ready，尽早注册：preload 同步读版本号时句柄必须已经挂上
ipcMain.on('app:version', (event) => {
  event.returnValue = app.getVersion();
});
ipcMain.handle('app:consumePendingOpenFiles', () => {
  const files = [...pendingOpenFiles];
  pendingOpenFiles.length = 0;
  return files;
});

/** 按协议拼请求头；本地服务（Ollama / LM Studio / llama.cpp）无需 Key，留空时不发送 Authorization */
function buildAuthHeaders(protocol: 'openai' | 'anthropic', apiKey: string): Record<string, string> {
  if (protocol === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// macOS：通过 Finder 双击或「打开方式」触发（可能早于 ready）
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openFileFromOS(filePath);
});

// Windows / Linux：文件路径通过命令行参数传入；二次启动交给已运行的实例
if (process.platform !== 'darwin') {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv, workingDirectory) => {
      const file = documentFromArgv(argv, workingDirectory);
      if (file) {
        openFileFromOS(file);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
    const initialFile = documentFromArgv(process.argv, process.cwd());
    if (initialFile) pendingOpenFiles.push(initialFile);
  }
}
const aiAbortControllers = new Map<string, AbortController>();
// 笔记库目录监听
let libraryWatcher: fs.FSWatcher | null = null;
let libraryChangeTimer: ReturnType<typeof setTimeout> | null = null;
const libraryChanged = new Set<string>();
// 笔记库全文索引
const searchIndex = new SearchIndex();

function createWindow() {

  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    title: 'iML Markdown Editor',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    vibrancy: 'sidebar', 
    visualEffectState: 'active',
    backgroundColor: '#00000000', 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../assets/logo.png'),
  });

  if (isDev) {
    // 开发模式：把渲染进程的控制台输出转发到终端，方便在命令行里看到 React / 编辑器的报错
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer:${level === 3 ? 'error' : 'warn'}] ${message} (${sourceId}:${line})`);
    });
    // 冒烟测试：IML_SMOKE_SHOT=/path.png 时，页面加载完成 6 秒后把窗口内容截图存盘（不需要系统的屏幕录制权限）
    const shotPath = process.env.IML_SMOKE_SHOT;
    if (process.env.IML_SMOKE_OPEN && isOpenableDocument(process.env.IML_SMOKE_OPEN)) pendingOpenFiles.push(process.env.IML_SMOKE_OPEN);
    if (shotPath) {
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            // 可选：先在页面里跑一段脚本（点开某个面板、输入文字），再截图
            if (process.env.IML_SMOKE_SCRIPT) {
              await mainWindow!.webContents.executeJavaScript(process.env.IML_SMOKE_SCRIPT).catch((e) => console.warn('[smoke] script failed:', e));
              await new Promise((r) => setTimeout(r, 1500));
            }
            // IML_SMOKE_RECT=x,y,w,h（CSS 像素）只截窗口的一块区域
            const rectEnv = (process.env.IML_SMOKE_RECT || '').split(',').map((n) => Number(n));
            const rect = rectEnv.length === 4 && rectEnv.every((n) => Number.isFinite(n)) ? { x: rectEnv[0], y: rectEnv[1], width: rectEnv[2], height: rectEnv[3] } : undefined;
            const image = await mainWindow!.webContents.capturePage(rect);
            fs.writeFileSync(shotPath, image.toPNG());
            console.log(`[smoke] screenshot saved to ${shotPath}`);
            console.log(`[smoke] windows: ${BrowserWindow.getAllWindows().map((w) => JSON.stringify(w.getTitle())).join(', ')}`);
          } catch (err) {
            console.warn('[smoke] capture failed:', err);
          }
        }, 6000);
      });
    }
    // 尝试载入 5173，如果失败则尝试 5174 (Vite 默认备选端口)
    // 冒烟：IML_SMOKE_QUERY=ai-config 时主窗口直接加载对应的独立窗口页面，方便截图
    const smokeQuery = process.env.IML_SMOKE_QUERY ? `?window=${process.env.IML_SMOKE_QUERY}` : '';
    mainWindow.loadURL(`http://localhost:5173${smokeQuery}`).catch(() => {
      mainWindow?.loadURL(`http://localhost:5174${smokeQuery}`);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 配置 / 关于 / 快捷键都是主窗口里的浮层，不再新开 BrowserWindow：
 * 多开窗口会让 Dock 与调度中心里出现好几个同名窗口。主窗口不在时先建出来再打开。
 */
function openDialogInMain(id: 'about' | 'shortcuts' | 'ai-config' | 'image-config' | 'settings') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow?.webContents.once('did-finish-load', () => {
      setTimeout(() => mainWindow?.webContents.send('dialog:open', id), 300);
    });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('dialog:open', id);
}

function setupAppMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      // macOS App 菜单（名称由 app.setName() 控制，label 在此不显示）
      label: 'iML Markdown Editor',
      submenu: [
        { label: '关于 iML Markdown Editor', click: () => openDialogInMain('about') },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 iML Markdown Editor' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 iML Markdown Editor' },
      ],
    },
    {
      label: '文件',
      submenu: [
        {
          label: '新建文档',
          accelerator: 'Cmd+N',
          click: () => mainWindow?.webContents.send('menu:new-file'),
        },
        {
          label: '打开文件…',
          accelerator: 'Cmd+O',
          click: () => mainWindow?.webContents.send('menu:open-file'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'Cmd+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        ...(isDev ? [
          { role: 'reload' as const, label: '重新加载' },
          { role: 'forceReload' as const, label: '强制重新加载' },
          { role: 'toggleDevTools' as const, label: '开发者工具' },
          { type: 'separator' as const },
        ] : []),
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '智能',
      submenu: [
        {
          label: '模型配置',
          accelerator: 'Cmd+Shift+M',
          click: () => openDialogInMain('ai-config'),
        },
        { type: 'separator' },
        {
          label: '图片生成配置',
          click: () => openDialogInMain('image-config'),
        },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        {
          label: '快捷键说明',
          accelerator: 'Cmd+/',
          click: () => openDialogInMain('shortcuts'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // 1. 注册核心 IPC 句柄
  try {
    setupFileSystemIPC();
  } catch (err) {
    console.error('Failed to setup FileSystem IPC:', err);
  }
  
  // AI Config IPC
  ipcMain.handle('ai:getConfig', () => getConfig());
  ipcMain.handle('ai:saveConfig', (_event, config) => saveConfig(config));

  // 本机模型（编辑器托管的 llama-server）：硬件信息、运行时安装、模型下载、进程管理
  try {
    setupLocalModel({ getConfig, saveConfig });
  } catch (err) {
    console.error('Failed to setup local model IPC:', err);
  }

  // 测试连接：按表单里的（未保存的）配置发一条极短的对话，返回耗时
  ipcMain.handle('ai:testConnection', async (_event, cfg: { protocol?: string; endpoint?: string; apiKey?: string; model?: string }) => {
    const endpoint = (cfg?.endpoint || '').replace(/\/$/, '');
    if (!endpoint) throw new Error('请先填写服务地址（Base URL）');
    const protocol: 'openai' | 'anthropic' = cfg?.protocol === 'anthropic' ? 'anthropic' : 'openai';
    const apiKey = cfg?.apiKey || '';
    if (protocol === 'anthropic' && !apiKey) throw new Error('Anthropic 协议需要 API Key');
    const model = cfg?.model || (protocol === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o');
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const url = protocol === 'anthropic' ? `${endpoint}/messages` : `${endpoint}/chat/completions`;
      const body = protocol === 'anthropic'
        ? { model, max_tokens: 16, messages: [{ role: 'user', content: '用一个词回答：你好' }] }
        : { model, max_tokens: 16, messages: [{ role: 'user', content: '用一个词回答：你好' }], stream: false };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(protocol, apiKey) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data: any = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error?.message || data.message || `HTTP ${resp.status}`);
      const reply = protocol === 'anthropic'
        ? String(data.content?.map((c: any) => c.text || '').join('') || '')
        : String(data.choices?.[0]?.message?.content || '');
      return { ok: true, latencyMs: Date.now() - started, reply: reply.trim(), endpoint, model };
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error('连接超时（30 秒）');
      throw new Error(err.message || String(err));
    } finally {
      clearTimeout(timer);
    }
  });

  // ── 笔记库目录监听：外部（同步盘 / 其他编辑器）改动 → 通知渲染进程刷新树、重载未修改的标签页 ──
  ipcMain.handle('library:watch', (_event, dirPath: string) => {
    if (libraryWatcher) {
      libraryWatcher.close();
      libraryWatcher = null;
    }
    if (!dirPath || !fs.existsSync(dirPath)) return false;
    try {
      libraryWatcher = fs.watch(dirPath, { recursive: true }, (_type, filename) => {
        if (!filename) return;
        const rel = filename.toString();
        // 隐藏文件（.DS_Store、同步盘的临时文件等）不触发
        if (rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) return;
        libraryChanged.add(path.join(dirPath, rel));
        if (libraryChangeTimer) clearTimeout(libraryChangeTimer);
        libraryChangeTimer = setTimeout(async () => {
          const paths = [...libraryChanged];
          libraryChanged.clear();
          await searchIndex.refresh(paths).catch(() => {});
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('library:changed', paths);
        }, 400);
      });
      libraryWatcher.on('error', (err) => console.warn('[library:watch]', err));
      // 监听开始的同时后台建索引
      searchIndex.build(dirPath).catch((err) => console.warn('[search] index build failed:', err));
      return true;
    } catch (err) {
      console.warn('[library:watch] failed:', err);
      return false;
    }
  });

  // ── 全文搜索 ──
  ipcMain.handle('search:query', (_event, query: string, limit?: number) => searchIndex.search(String(query || ''), limit));
  ipcMain.handle('search:status', () => searchIndex.status());
  ipcMain.handle('search:listNotes', () => searchIndex.listNotes());
  ipcMain.handle('search:backlinks', (_event, title: string) => searchIndex.backlinks(String(title || '')));

  // iCloud Drive 下的笔记库路径（不存在 iCloud Drive 时返回 null）；选用时自动建目录
  ipcMain.handle('app:getICloudLibraryPath', () => {
    const home = app.getPath('home');
    const cloudRoot = process.platform === 'darwin'
      ? path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
      : process.platform === 'win32'
        ? path.join(home, 'iCloudDrive')
        : '';
    if (!cloudRoot || !fs.existsSync(cloudRoot)) return null;
    const lib = path.join(cloudRoot, 'iML Notes');
    try {
      if (!fs.existsSync(lib)) fs.mkdirSync(lib, { recursive: true });
      return lib;
    } catch {
      return null;
    }
  });

  // 设置窗口请求清空会话 → 由主窗口执行（会话只存在于主窗口的 localStorage）
  ipcMain.on('app:clearSession', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('session:clear');
  });

  // 拉取模型列表：兼容 OpenAI /models 与 Anthropic /models；本地 Ollama / LM Studio 无需 Key
  ipcMain.handle('ai:listModels', async (_event, { endpoint, apiKey, protocol }: { endpoint: string; apiKey: string; protocol: string }) => {
    const base = (endpoint || '').replace(/\/$/, '');
    if (!base) throw new Error('请先填写服务地址（Base URL）');
    const headers = buildAuthHeaders(protocol === 'anthropic' ? 'anthropic' : 'openai', apiKey || '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(`${base}/models`, { headers, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: any = await resp.json();
      const list: any[] = Array.isArray(data) ? data : (data.data || data.models || []);
      return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error('连接超时：请确认本地模型服务已启动，或检查服务地址');
      throw new Error(`无法获取模型列表：${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  });
  
  // 新特性介绍：记录用户最后看过哪个版本的介绍（单独一个小文件，不随设置整体覆盖）
  const whatsNewPath = () => path.join(getPaths().userDataPath, 'whats-new.json');
  ipcMain.handle('app:getWhatsNewState', () => {
    let lastSeen: string | null = null;
    try { lastSeen = JSON.parse(fs.readFileSync(whatsNewPath(), 'utf8')).lastSeenVersion || null; } catch { /* 首次安装 */ }
    return { current: app.getVersion(), lastSeen };
  });
  ipcMain.handle('app:markWhatsNewSeen', () => {
    try { fs.writeFileSync(whatsNewPath(), JSON.stringify({ lastSeenVersion: app.getVersion(), seenAt: Date.now() }), 'utf8'); } catch (err) { console.warn('[whats-new] write failed', err); }
    return true;
  });

  // App Settings IPC
  ipcMain.handle('app:getSettings', () => getAppSettings());
  ipcMain.handle('app:saveSettings', (_event, settings) => {
    const result = saveAppSettings(settings);
    if (result.success && mainWindow) {
      mainWindow.webContents.send('settings:changed', settings);
    }
    return result;
  });

  // 2. 环境设置
  // Create standard macOS menu
  setupAppMenu();

  // 仅开发模式手动设置 Dock 图标；打包后由 .icns 提供。
  // 运行时用满幅 logo.png 覆盖会丢掉 macOS 图标的标准留白，导致 Dock 里比其他应用图标大一圈。
  if (isDev && process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(path.join(process.cwd(), 'assets/icon-mac.png'));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  createWindow();
  
  // AI Stop request
  ipcMain.on('ai:stop', (_event, requestId: string) => {
    const controller = aiAbortControllers.get(requestId);
    if (controller) {
      controller.abort();
      aiAbortControllers.delete(requestId);
      console.log(`[AI] Request ${requestId} aborted by user`);
    }
  });

  ipcMain.on('ai:chat', async (event, { messages, requestId, maxTokens }) => {
    const config = getConfig();
    let apiKey: string = config.apiKey || '';
    let endpoint = (config.endpoint || '').replace(/\/$/, '');
    let model = config.model || 'gpt-4o';
    let protocol: 'openai' | 'anthropic' = config.protocol || 'openai';

    // 本机模型：请求只发往 127.0.0.1 上由编辑器托管的 llama-server；没启动就先拉起来
    if (isBuiltinService(config)) {
      try {
        const local = await ensureBuiltinEndpoint();
        endpoint = local.endpoint;
        model = local.model;
        protocol = 'openai';
        apiKey = '';
      } catch (err: any) {
        event.sender.send(`ai:chat-error-${requestId}`, `本机模型：${err?.message || err}`);
        return;
      }
    }

    if (!endpoint) {
      event.sender.send(`ai:chat-error-${requestId}`, '请先在「模型配置」中填写服务地址（Base URL）');
      return;
    }
    if (protocol === 'anthropic' && !apiKey) {
      event.sender.send(`ai:chat-error-${requestId}`, 'Anthropic 协议需要 API Key，请在「模型配置」中填写');
      return;
    }

    const controller = new AbortController();
    aiAbortControllers.set(requestId, controller);

    try {
      let response: Response;

      if (protocol === 'anthropic') {
        // ── Anthropic Messages API ────────────────────────────────────────
        const systemMsg = messages.find((m: any) => m.role === 'system');
        const chatMessages = messages.filter((m: any) => m.role !== 'system');
        const url = `${endpoint}/messages`;
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...buildAuthHeaders('anthropic', apiKey) },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens || 8192,
            ...(systemMsg ? { system: systemMsg.content } : {}),
            messages: chatMessages,
            stream: true,
          }),
          signal: controller.signal,
        });
      } else {
        // ── OpenAI-compatible (default) ───────────────────────────────────
        response = await fetch(`${endpoint}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...buildAuthHeaders('openai', apiKey) },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
          }),
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        const msg = errorData.error?.message || errorData.message || `API 请求失败: ${response.status}`;
        event.sender.send(`ai:chat-error-${requestId}`, msg);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        event.sender.send(`ai:chat-error-${requestId}`, '无法获取响应流');
        return;
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let lineBuffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          event.sender.send(`ai:chat-done-${requestId}`, fullContent);
          break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { currentEvent = ''; continue; }

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }

          if (trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              let content = '';

              if (protocol === 'anthropic') {
                // content_block_delta → text_delta
                if (currentEvent === 'content_block_delta' && json.delta?.type === 'text_delta') {
                  content = json.delta.text || '';
                }
              } else {
                content = json.choices?.[0]?.delta?.content || '';
              }

              if (content) {
                fullContent += content;
                event.sender.send(`ai:chat-chunk-${requestId}`, content);
              }
            } catch (_) { /* partial JSON, skip */ }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        event.sender.send(`ai:chat-error-${requestId}`, 'REQUEST_ABORTED');
      } else {
        event.sender.send(`ai:chat-error-${requestId}`, `网络错误: ${err.message}`);
      }
    } finally {
      aiAbortControllers.delete(requestId);
    }
  });

  ipcMain.on('open-about', () => openDialogInMain('about'));
  ipcMain.on('open-shortcuts', () => openDialogInMain('shortcuts'));
  ipcMain.on('open-ai-config', () => openDialogInMain('ai-config'));
  ipcMain.on('open:image-config', () => openDialogInMain('image-config'));
  ipcMain.on('open:settings', () => openDialogInMain('settings'));

  // Forward settings preview/revert from settings window to main window
  ipcMain.on('settings:preview', (_event, settings) => {
    if (mainWindow) mainWindow.webContents.send('settings:preview', settings);
  });
  ipcMain.on('settings:revert', () => {
    if (mainWindow) mainWindow.webContents.send('settings:revert');
  });

  ipcMain.handle('open-url', async (_event, url: string) => { shell.openExternal(url); });
  
  // App Update Check IPC
  ipcMain.handle('app:checkUpdates', async () => {
    try {
      const response = await fetch('https://api.github.com/repos/imoling/iml-markdown-editor/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'iML-Markdown-Editor'
        }
      });
      
      if (!response.ok) {
        if (response.status === 404) return { success: false, error: '未发现任何发布版本' };
        throw new Error(`GitHub API returned ${response.status}`);
      }
      
      const data: any = await response.json();
      return {
        success: true,
        latestVersion: data.tag_name.replace(/^v/, ''),
        releaseUrl: data.html_url
      };
    } catch (err: any) {
      console.error('Update check failed:', err);
      return { success: false, error: '无法连接到更新服务器，请检查网络设置' };
    }
  });

  // ── AI 图片生成（插入图片对话框 / AI 气泡「AI 图片」模式）──────────────────
  ipcMain.handle(
    'ai:generateImage',
    async (_, { prompt, config: cfg }: { prompt: string; config: any }): Promise<{ url: string }[]> => {
      function bufToDataUrl(buf: Buffer, mimeType: string): string {
        return `data:${mimeType};base64,${buf.toString('base64')}`;
      }

      function assertAsciiHeader(value: string, label: string) {
        for (let i = 0; i < value.length; i++) {
          if (value.charCodeAt(i) > 127) {
            throw new Error(`${label} 包含非 ASCII 字符（位置 ${i}，字符"${value[i]}"），HTTP Header 不支持中文，请检查配置`);
          }
        }
      }

      // 提前校验 Header 值，避免 Node http 遇到非 ASCII 时抛出难懂的错误
      assertAsciiHeader(cfg.apiKey || '', 'API Key');
      if (cfg.endpoint) assertAsciiHeader(cfg.endpoint, '端点 URL');

      const results: { url: string }[] = [];

      if (cfg.provider === 'gemini' || cfg.provider === 'gemini-imagen' || cfg.provider === 'gemini-flash') {
        // 未指定模型时默认走 Imagen，与「图片生成配置」界面默认高亮的选项一致
        const useImagen = cfg.provider === 'gemini-imagen'
          || (cfg.provider !== 'gemini-flash' && (!cfg.model || cfg.model.includes('imagen')));
        const model = cfg.model || (useImagen ? 'imagen-4.0-generate-001' : 'gemini-2.0-flash-exp-image-generation');
        if (useImagen) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${cfg.apiKey}`;
          const { status, text: rawText } = await nodePost(url, JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: '16:9' },
          }), { 'Content-Type': 'application/json' });
          if (status < 200 || status >= 300 || !rawText) throw new Error(`Gemini Imagen HTTP ${status}（${model}）: ${rawText || '(empty)'}`);
          let data: any;
          try { data = JSON.parse(rawText); } catch { throw new Error(`Gemini Imagen 非 JSON（${status}）: ${rawText.slice(0, 200)}`); }
          if (!data.predictions?.length) throw new Error(data.error?.message || `Imagen 未返回图片: ${rawText.slice(0, 200)}`);
          for (const pred of data.predictions) {
            const b64 = pred.bytesBase64Encoded;
            if (!b64) continue;
            results.push({ url: bufToDataUrl(Buffer.from(b64, 'base64'), 'image/png') });
          }
        } else {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`;
          const { status, text: rawText } = await nodePost(url, JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 1.0 },
          }), { 'Content-Type': 'application/json' });
          if (status < 200 || status >= 300) throw new Error(`Gemini Flash HTTP ${status}: ${rawText.slice(0, 300)}`);
          let data: any;
          try { data = JSON.parse(rawText); } catch { throw new Error(`Gemini Flash 非 JSON: ${rawText.slice(0, 200)}`); }
          if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
          const parts: any[] = data.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              const mime = part.inlineData.mimeType || 'image/jpeg';
              results.push({ url: bufToDataUrl(Buffer.from(part.inlineData.data, 'base64'), mime) });
              break;
            }
          }
          if (results.length === 0) throw new Error(`Gemini Flash 未返回图片（${model}）`);
        }
      } else if (cfg.provider === 'minimax') {
        const { status, text: rawText } = await nodePost(
          'https://api.minimaxi.com/v1/image_generation',
          JSON.stringify({ model: cfg.model || 'image-01', prompt, response_format: 'url', n: 1, aspect_ratio: '16:9', prompt_optimizer: false }),
          { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        );
        if (status < 200 || status >= 300) throw new Error(`MiniMax HTTP ${status}: ${rawText.slice(0, 300)}`);
        let data: any;
        try { data = JSON.parse(rawText); } catch { throw new Error(`MiniMax 返回非 JSON: ${rawText.slice(0, 200)}`); }
        if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
          throw new Error(data.base_resp.status_msg || `MiniMax 错误码 ${data.base_resp.status_code}`);
        }
        const imageUrls: string[] = data.data?.image_urls || [];
        if (imageUrls.length === 0) throw new Error(`MiniMax 未返回图片: ${rawText.slice(0, 200)}`);
        for (const imageUrl of imageUrls) {
          results.push({ url: bufToDataUrl(await nodeGetBuffer(imageUrl), 'image/jpeg') });
        }
      } else if (cfg.provider === 'volcengine') {
        const model = cfg.model || 'doubao-seedream-5-0-260128';
        const { status, text: rawText } = await nodePost(
          'https://ark.cn-beijing.volces.com/api/v3/images/generations',
          JSON.stringify({ model, prompt, size: '2560x1440', n: 1, response_format: 'url' }),
          { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        );
        if (status < 200 || status >= 300) throw new Error(`火山引擎 HTTP ${status}: ${rawText.slice(0, 300)}`);
        let data: any;
        try { data = JSON.parse(rawText); } catch { throw new Error(`火山引擎返回非 JSON: ${rawText.slice(0, 200)}`); }
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        const items: any[] = data.data || [];
        if (items.length === 0) throw new Error(`火山引擎未返回图片: ${rawText.slice(0, 200)}`);
        for (const item of items) {
          if (item.b64_json) {
            results.push({ url: bufToDataUrl(Buffer.from(item.b64_json, 'base64'), 'image/png') });
          } else if (item.url) {
            results.push({ url: bufToDataUrl(await nodeGetBuffer(item.url), 'image/png') });
          }
        }
      } else if (cfg.provider === 'custom' && cfg.endpoint) {
        const { text: rawText } = await nodePost(
          cfg.endpoint,
          JSON.stringify({ model: cfg.model, prompt, n: 1 }),
          { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        );
        let data: any;
        try { data = JSON.parse(rawText); } catch { throw new Error(`Custom 端点返回非 JSON: ${rawText.slice(0, 200)}`); }
        const imgs: any[] = data.data || data.images || data.output || [];
        for (const img of imgs) {
          const b64 = img.b64_json || img.base64;
          if (b64) {
            results.push({ url: bufToDataUrl(Buffer.from(b64, 'base64'), 'image/png') });
          } else if (img.url) {
            results.push({ url: bufToDataUrl(await nodeGetBuffer(img.url), 'image/png') });
          }
        }
      } else {
        throw new Error(`未知图片生成提供商「${cfg.provider || '(未配置)'}」，请在「图片生成配置」中选择提供商并填入 API Key`);
      }

      if (results.length === 0) {
        throw new Error('图片生成未返回结果，请检查 API Key 是否正确，或尝试更换模型');
      }
      return results;
    },
  );

  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
