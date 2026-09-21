/**
 * Tauri 壳的前端适配层：把 Rust 那边的命令（src-tauri/src/lib.rs）包成和 Electron preload（electron/preload.ts）
 * 一模一样的 `window.api`。界面代码只认 `window.api`，不知道外面套的是哪个壳。
 *
 * 分工：Rust 只做读写文件这类系统调用；文件名怎么起、网页标题怎么解析、哪个安装包是这台电脑的，
 * 用的是和 Electron 主进程同一份 TypeScript（electron/shared、electron/update.ts），那些都有测试。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { assetFileName } from '../../electron/shared/assetNames';
import { extractHtmlTitle, detectCharset } from '../../electron/shared/pageTitle';
import { exportCss, exportDocument } from '../../electron/shared/exportDoc';
import { describeRelease, pickLatestRelease } from '../../electron/update';
import { numberedPath } from '../../electron/shared/imageTiles';

declare const __APP_VERSION__: string;

/** 本应用在 GitHub Releases 里的标签前缀（同 electron/main.ts） */
const RELEASE_TAG_PREFIX = 'lite-v';
const DOC_EXT_RE = /\.(md|markdown|mdown|mkd|txt)$/i;

type Listener = (...args: any[]) => void;
type WindowApi = Window['api'] & { assetBase: string; image: { toWebp: (bytes: ArrayBuffer, maxWidth: number, maxHeight: number, quality: number) => Promise<ArrayBuffer | null> } };

function detectPlatform(): { platform: string; arch: string } {
  const ua = navigator.userAgent;
  const platform = /Mac/i.test(ua) ? 'darwin' : /Windows/i.test(ua) ? 'win32' : 'linux';
  // 系统 WebView 的 UA 不可靠地暴露架构：Apple 芯片的 Mac 也自称 Intel。macOS 一律按 arm64 挑安装包
  //（x64 的机器挑不到 arm64 之外的也无妨——describeRelease 挑不出来时界面会退回到发布页），Windows 看 UA 里有没有 ARM
  const arch = platform === 'darwin' ? 'arm64' : /ARM64|aarch64/i.test(ua) ? 'arm64' : 'x64';
  return { platform, arch };
}

const dirOf = (filePath: string) => filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
const baseOf = (filePath: string) => filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 二进制内容走请求体（不经过 JSON），路径这类参数放请求头——头里只能是 ASCII，所以先 encodeURIComponent */
const rawInvoke = <T>(cmd: string, body: ArrayBuffer | Uint8Array, headers: Record<string, string>) =>
  invoke<T>(cmd, body instanceof Uint8Array ? body : new Uint8Array(body), { headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, encodeURIComponent(v)])) });

/** 问用户存哪。调试构建的冒烟测试里（IML_SMOKE_EXPORT_DIR）不弹对话框，直接存进指定的目录 */
async function askSavePath(defaultPath: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const smokeDir = await invoke<string | null>('smoke_export_dir').catch(() => null);
  if (smokeDir) return `${smokeDir}/${baseOf(defaultPath)}`;
  return (await saveDialog({ defaultPath, filters })) || null;
}

export function createTauriApi(): WindowApi {
  const { platform, arch } = detectPlatform();
  // Windows 的 WebView2 不认自定义协议的写法，Tauri 把它映射成 http://<协议名>.localhost/
  const assetBase = platform === 'win32' ? 'http://iml-asset.localhost/' : 'iml-asset://localhost/';

  // ── 事件 ──
  // Electron 那边主进程能往界面发消息；这里有两个来源：Rust 发来的（菜单、文件夹变动、系统递进来的文件），
  // 和本来要经主进程转一道、现在界面自己就能发的（设置预览、清空会话）
  const listeners = new Map<string, Set<Listener>>();
  const subscribed = new Set<string>();
  const emitLocal = (channel: string, ...args: any[]) => listeners.get(channel)?.forEach((cb) => { try { cb(...args); } catch (e) { console.error(`[event:${channel}]`, e); } });
  const on = (channel: string, callback: Listener) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);
    if (subscribed.has(channel)) return;
    subscribed.add(channel);
    void listen(channel, (event) => emitLocal(channel, event.payload)).catch((e) => console.error(`[listen:${channel}]`, e));
  };

  // ── 窗口标题跟着 document.title 走（调度中心、Dock 的窗口列表里看得到）──
  const syncTitle = () => { void getCurrentWindow().setTitle(document.title).catch(() => {}); };
  const titleEl = document.querySelector('title');
  if (titleEl) new MutationObserver(syncTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });

  // ── 打印 / 导出 PDF ──
  // 系统 WebView 没有「直接存成 PDF」的接口。做法：把要导出的文档摆进一个只在打印时露面的容器（Shadow DOM 隔开界面的样式），
  // 然后叫系统的打印面板——「存储为 PDF」就在面板里，分页、页边距也由它管
  const PRINT_ROOT_ID = 'iml-print-root';
  const ensurePrintStyles = () => {
    if (document.getElementById('iml-print-style')) return;
    const style = document.createElement('style');
    style.id = 'iml-print-style';
    style.textContent = `
      @media screen { #${PRINT_ROOT_ID} { display: none; } }
      @media print {
        html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
        body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
        #${PRINT_ROOT_ID} { display: block; }
      }`;
    document.head.appendChild(style);
  };
  /** 把要导出的文档摆进打印容器，等图片到位。返回一个收拾现场的函数 */
  const stagePrintDocument = async (htmlContent: string, filePath: string): Promise<() => void> => {
    ensurePrintStyles();
    document.getElementById(PRINT_ROOT_ID)?.remove();
    const host = document.createElement('div');
    host.id = PRINT_ROOT_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // 页边距由纸张设置管，正文容器自己不再留白；提示块、代码块的底色要照样印出来；提示块、图片尽量不跨页
    style.textContent = `${exportCss('.export-body')}
      .export-body { padding: 0; max-width: none; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      pre, table, img, .callout, .math-block, .mermaid-static-rendered { break-inside: avoid; }
      h1, h2, h3, h4 { break-after: avoid; }`;
    const body = resolveImages(htmlContent, filePath.startsWith('new-') ? null : dirOf(filePath));
    body.className = 'export-body';
    // 有公式：Shadow DOM 把界面的样式挡在外面了，KaTeX 的规则得自己带进来。
    // 字体不能指望打印时再去取——这个容器平时是隐藏的，公式字体从没被用到、也就从没加载过，而 WebKit 在打印过程中
    // 是挂起资源加载的：字体等不来，整份 PDF 要么是空白页、要么干脆 0 字节（实测两种都出现过）。
    // 所以 @font-face 不带进来（Shadow DOM 里的本来也不生效），改用界面全局登记的那一份，并在打印之前把它们真正加载好
    const hasMath = !!body.querySelector('.katex');
    if (hasMath && !(window as any).__imlPdfNoKatex) {
      const katex = (await (await import('../utils/exportImage')).katexStyles(false)).replace(/@font-face\s*\{[^}]*\}/g, '');
      style.textContent = `${katex}\n${style.textContent}`;
      await Promise.race([
        Promise.all(Array.from(document.fonts).filter((face) => /KaTeX_/.test(face.family)).map((face) => face.load().catch(() => null))),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    }
    shadow.append(style, body);
    // 上面有好几处等待：摆进去之前再清一遍，页面里任何时候都只能有一份要打印的文档
    document.querySelectorAll(`#${PRINT_ROOT_ID}`).forEach((el) => el.remove());
    document.body.appendChild(host);
    // 图片到位了再打印，不然 PDF 里是一个个空框；坏掉的图最多等 4 秒
    await Promise.race([
      Promise.all(Array.from(body.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })))),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    return () => host.remove();
  };
  const resolveImages = (html: string, noteDir: string | null) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    box.querySelectorAll<HTMLElement>('img[src], audio[src], source[src]').forEach((el) => {
      const src = el.getAttribute('src') || '';
      const abs = absolutePathOf(src, noteDir);
      if (abs) el.setAttribute('src', assetBase + encodeURIComponent(abs));
    });
    return box;
  };
  /** 文档里的图片地址 → 本地绝对路径；网络图片、data: 之类返回 null（不用动） */
  const absolutePathOf = (src: string, noteDir: string | null): string | null => {
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return null;
    if (src.startsWith(assetBase)) { try { return decodeURIComponent(src.slice(assetBase.length)); } catch { return null; } }
    let rel = src.replace(/&amp;/g, '&').split(/[?#]/)[0];
    try { rel = decodeURI(rel); } catch { /* 保持原样 */ }
    if (/^file:\/\//i.test(rel)) { rel = rel.replace(/^file:\/\//i, ''); if (/^\/[A-Za-z]:\//.test(rel)) rel = rel.slice(1); }
    if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || !noteDir) return null;
    const sep = noteDir.includes('\\') ? '\\' : '/';
    const parts = noteDir.split(/[\\/]/);
    for (const seg of rel.split(/[\\/]/)) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { if (parts.length > 1) parts.pop(); continue; }
      parts.push(seg);
    }
    return parts.join(sep);
  };

  const api: WindowApi = {
    assetBase,
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',

    dialog: {
      // 参数是 Electron 的写法（properties: ['openFile', 'multiSelections', 'openDirectory']），这里翻译一下
      open: async (options?: any) => {
        const props: string[] = options?.properties || ['openFile', 'multiSelections'];
        const picked = await openDialog({ directory: props.includes('openDirectory'), multiple: props.includes('multiSelections'), filters: options?.filters, defaultPath: options?.defaultPath });
        if (!picked) return null;
        return Array.isArray(picked) ? picked : [picked];
      },
      save: async (options?: any) => (await saveDialog({ defaultPath: options?.defaultPath, filters: options?.filters || [{ name: 'Markdown', extensions: ['md'] }] })) || null,
    },

    fs: {
      readFile: async (filePath) => { try { return { success: true, content: await invoke<string>('fs_read_text', { path: filePath }), filePath }; } catch (e) { return { success: false, error: message(e) }; } },
      writeFile: async (filePath, content) => { try { await invoke('fs_write_text', { path: filePath, content }); return { success: true, filePath }; } catch (e) { return { success: false, error: message(e) }; } },
      readDir: async (dirPath) => { try { return { success: true, files: await invoke<any[]>('fs_read_dir', { path: dirPath }), path: dirPath }; } catch (e) { return { success: false, error: message(e) }; } },
      saveImage: async (activeFilePath, fileName, buffer) => {
        try {
          // 剪贴板截图统一叫 image.png：换成时间戳名；空格等字符换掉，Markdown 地址里不用转义
          const saved = await rawInvoke<{ path: string; bytes: number }>('fs_save_asset', buffer, { 'x-dir': dirOf(activeFilePath), 'x-name': assetFileName(fileName) });
          return { success: true, ...saved };
        } catch (e) { return { success: false, error: message(e) }; }
      },
      rename: async (oldPath, newPath) => { try { await invoke('fs_rename', { oldPath, newPath }); return { success: true, oldPath, newPath }; } catch (e) { return { success: false, error: message(e) }; } },
      copy: async (sourcePath, targetPath) => { try { await invoke('fs_copy', { sourcePath, targetPath }); return { success: true, sourcePath, targetPath }; } catch (e) { return { success: false, error: message(e) }; } },
      delete: async (path) => { try { return { success: true, path, permanently: await invoke<boolean>('fs_delete', { path }) }; } catch (e) { return { success: false, error: message(e) }; } },
      exists: (path) => invoke<boolean>('fs_exists', { path }),
      mkdir: async (dirPath) => { try { await invoke('fs_mkdir', { path: dirPath }); return { success: true, path: dirPath }; } catch (e) { return { success: false, error: message(e) }; } },
    },

    export: {
      // 弹系统的打印面板（Windows：WebView2 的面板自带预览和「另存为 PDF」）。macOS 上界面会改走下面的 pdfTo
      pdf: async (htmlContent, _defaultPath, filePath) => {
        try {
          await stagePrintDocument(htmlContent, filePath); // 面板什么时候关掉无从得知，容器留到下一次导出时再换
          await invoke('print_window');
          return { success: true, printed: true } as any;
        } catch (e) { return { success: false, error: message(e) }; }
      },
      // macOS：直接存成分页的 A4 PDF，不弹打印面板
      ...(platform === 'darwin' ? {
        pdfTo: async (htmlContent: string, target: string, filePath: string) => {
          let cleanup: (() => void) | null = null;
          try {
            cleanup = await stagePrintDocument(htmlContent, filePath);
            await invoke('export_pdf', { path: target });
            return { success: true, path: target };
          } catch (e) { return { success: false, error: message(e) }; } finally { cleanup?.(); }
        },
      } : {}),
      html: async (htmlContent, defaultPath, filePath) => {
        try {
          const target = await askSavePath(`${defaultPath.replace(DOC_EXT_RE, '')}.html`, [{ name: 'HTML', extensions: ['html'] }]);
          if (!target) return { success: false, canceled: true };
          // 单文件 HTML：把本地图片读进来内联成 data URL，拷到哪里都能看
          const box = resolveImages(htmlContent, filePath.startsWith('new-') ? null : dirOf(filePath));
          for (const img of Array.from(box.querySelectorAll<HTMLImageElement>('img[src]'))) {
            const src = img.getAttribute('src') || '';
            if (!src.startsWith(assetBase)) continue;
            try {
              const blob = await (await fetch(src)).blob();
              if (blob.size > 12 * 1024 * 1024) continue;
              img.setAttribute('src', await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); }));
            } catch { /* 找不到的图片保持原地址 */ }
          }
          // 有公式：把 KaTeX 的样式连同字体一起内联进去，这个文件拷到哪里公式都是好的
          const katex = box.querySelector('.katex') ? await (await import('../utils/exportImage')).katexStyles(true) : '';
          await invoke('export_write_text', { path: target, content: exportDocument(`${katex ? `<style>${katex}</style>` : ''}${box.innerHTML}`, baseOf(target).replace(/\.html?$/i, '')) });
          return { success: true, path: target };
        } catch (e) { return { success: false, error: message(e) }; }
      },
      saveFile: async (defaultName, bytes, filterName, extension) => {
        try {
          const ext = String(extension || '').replace(/[^a-z0-9]/gi, '');
          const target = await askSavePath(`${String(defaultName || '未命名').replace(DOC_EXT_RE, '')}.${ext}`, [{ name: String(filterName || ext), extensions: [ext] }]);
          if (!target) return { success: false, canceled: true };
          await rawInvoke('export_write_bytes', bytes, { 'x-path': target });
          return { success: true, path: target };
        } catch (e) { return { success: false, error: message(e) }; }
      },
      askPath: async (defaultName, filterName, extension) => {
        const ext = String(extension || '').replace(/[^a-z0-9]/gi, '');
        return askSavePath(`${String(defaultName || '未命名').replace(DOC_EXT_RE, '')}.${ext}`, [{ name: String(filterName || ext), extensions: [ext] }]);
      },
      writeFiles: async (target, parts) => {
        try {
          const paths: string[] = [];
          for (let i = 0; i < parts.length; i++) {
            const out = numberedPath(target, i, parts.length);
            await rawInvoke('export_write_bytes', parts[i], { 'x-path': out });
            paths.push(out);
          }
          return { success: true, paths };
        } catch (e) { return { success: false, error: message(e) }; }
      },
      open: (filePath) => invoke<boolean>('export_open', { path: filePath }),
      reveal: (filePath) => invoke<boolean>('export_reveal', { path: filePath }),
    },

    shell: {
      openExternal: (url) => invoke<void>('open_external', { url }).catch((e) => console.warn('[openExternal]', e)),
      showItemInFolder: (path) => invoke<void>('reveal_in_folder', { path }).catch((e) => console.warn('[reveal]', e)),
    },

    folder: {
      watch: (dirPath) => invoke<boolean>('folder_watch', { path: dirPath }),
    },

    web: {
      fetchTitle: async (url) => {
        try {
          const head = await invoke<{ contentType: string; body: number[] }>('fetch_page_head', { url });
          const bytes = new Uint8Array(head.body);
          const charset = detectCharset(head.contentType, new TextDecoder('latin1').decode(bytes.subarray(0, 4096)));
          let html: string;
          try { html = new TextDecoder(charset).decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
          return extractHtmlTitle(html);
        } catch { return null; } // 任何失败都返回 null：调用方保留原链接即可
      },
      fetchImage: async (url) => {
        try { return new Uint8Array(await invoke<ArrayBuffer>('fetch_image', { url })); } catch { return null; }
      },
    },

    image: {
      toWebp: async (bytes, maxWidth, maxHeight, quality) => {
        try { return await rawInvoke<ArrayBuffer>('image_to_webp', bytes, { 'x-max-width': String(maxWidth), 'x-max-height': String(maxHeight), 'x-quality': String(quality) }); } catch (e) { console.warn('[image:toWebp]', e); return null; }
      },
    },

    events: {
      on,
      send: (channel, ...args) => emitLocal(channel, ...args),
    },

    app: {
      platform,
      checkUpdates: async () => {
        try {
          const release = pickLatestRelease(JSON.parse(await invoke<string>('fetch_releases')), RELEASE_TAG_PREFIX);
          if (!release) return { success: false, error: '未发现任何发布版本' };
          return describeRelease(release, platform, arch, RELEASE_TAG_PREFIX);
        } catch (e) {
          console.error('Update check failed:', e);
          return { success: false, error: '无法连接到更新服务器，请检查网络设置' };
        }
      },
      minimize: () => { void getCurrentWindow().minimize(); },
      maximize: () => { void getCurrentWindow().toggleMaximize(); },
      close: () => { void getCurrentWindow().close(); },
      getSettings: () => invoke<any>('settings_get'),
      saveSettings: async (settings) => {
        try {
          await invoke('settings_save', { settings });
          emitLocal('settings:changed', settings);
          return { success: true };
        } catch (e) { return { success: false, error: message(e) }; }
      },
      openSettings: () => emitLocal('dialog:open', 'settings'),
      consumePendingOpenFiles: () => invoke<string[]>('consume_pending_open_files'),
      clearSession: () => emitLocal('session:clear'),
      previewSettings: (settings) => emitLocal('settings:preview', settings),
      revertSettings: () => emitLocal('settings:revert'),
    },
  };
  return api;
}
