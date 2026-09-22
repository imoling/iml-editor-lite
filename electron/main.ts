import { app, BrowserWindow, ipcMain, nativeImage, Menu, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupFileSystemIPC } from './ipc/fileSystem';
import { describeRelease, pickLatestRelease } from './update';
import { registerAssetScheme, handleAssetProtocol, fetchPageTitle, fetchImageBytes } from './assets';

/** 菜单栏、窗口标题上的名字（打包用的名字在 package.json 的 build.productName，两处保持一致） */
const APP_NAME = 'iML 编辑器';
/** 本应用在 GitHub Releases 里的标签前缀：拆成独立仓库之前和「iML 笔记」共用一个仓库靠它区分，老版本都是这个前缀，沿用 */
const RELEASE_TAG_PREFIX = 'lite-v';

const isDev = process.env.NODE_ENV === 'development';

// macOS 菜单栏 App 名称来自 app.getName()，必须在 ready 前设置
app.name = APP_NAME;
app.setName(APP_NAME);
// 数据目录钉死成一个英文名：不跟着显示名变（以后改名不丢设置），也和「iML 笔记」的数据分开放
app.setPath('userData', path.join(app.getPath('appData'), 'iML Editor'));

// 冒烟测试：IML_SMOKE_USERDATA 指向临时目录，配置 / 运行时 / 模型都不碰用户的真实数据
if (isDev && process.env.IML_SMOKE_USERDATA) app.setPath('userData', process.env.IML_SMOKE_USERDATA);
// 文档里的本地图片走 iml-asset://（必须在 ready 之前登记协议）
registerAssetScheme();

// Simple file-based store - defer initialization
let _userDataPath: string;

function getPaths() {
  if (!_userDataPath) _userDataPath = app.getPath('userData');
  return { userDataPath: _userDataPath };
}

function getAppSettings() {
  const { userDataPath } = getPaths();
  const settingsPath = path.join(userDataPath, 'app-settings.json');
  let settings: any = {
    appearanceMode: 'light',
    startupBehavior: 'restore',
    autoSave: false
  };
  
  try {
    if (fs.existsSync(settingsPath)) {
      settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
    }
  } catch (err) {
    console.error('Failed to read settings:', err);
  }

  return settings;
}

/** 拼写检查默认关：中文文档里满屏红色波浪线弊大于利，需要的人在设置里打开 */
function applySpellcheck(enabled: boolean) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.session.setSpellCheckerEnabled(enabled);
  }
}

function saveAppSettings(settings: any) {
  const { userDataPath } = getPaths();
  const settingsPath = path.join(userDataPath, 'app-settings.json');
  try {
    // 合并写入：各个设置入口只传自己管的字段，不能把别人的字段冲掉
    let existing: any = {};
    try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {}; } catch { /* 首次保存 */ }
    const merged = { ...existing, ...(settings || {}) };
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
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
  // 冒烟测试：IML_SMOKE_VERSION=26.1.0 让应用以为自己是旧版本，用来看真实的「发现新版本」提醒
  event.returnValue = (isDev && process.env.IML_SMOKE_VERSION) || app.getVersion();
});
ipcMain.handle('app:consumePendingOpenFiles', () => {
  const files = [...pendingOpenFiles];
  pendingOpenFiles.length = 0;
  return files;
});

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
// 侧边栏里打开的那个文件夹的监听
let folderWatcher: fs.FSWatcher | null = null;
let folderChangeTimer: ReturnType<typeof setTimeout> | null = null;
const folderChanged = new Set<string>();

function createWindow() {
  // 冒烟测试：IML_SMOKE_OFFSCREEN=1 时用离屏渲染（不显示窗口，按定时器出帧），显示器休眠、无人值守时也能截图；
  // IML_SMOKE_SIZE=1440x900 指定窗口大小
  const smokeOffscreen = isDev && process.env.IML_SMOKE_OFFSCREEN === '1';
  const [smokeW, smokeH] = (isDev ? process.env.IML_SMOKE_SIZE || '' : '').split('x').map((n) => Number(n));

  mainWindow = new BrowserWindow({
    width: smokeW > 0 ? smokeW : 1024,
    height: smokeH > 0 ? smokeH : 768,
    show: !smokeOffscreen,
    minWidth: 800,
    minHeight: 600,
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    vibrancy: 'sidebar', 
    visualEffectState: 'active',
    backgroundColor: '#00000000', 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      ...(smokeOffscreen ? { offscreen: true } : {}),
    },
    icon: path.join(__dirname, '../assets/lite/icon-1024.png'),
  });
  if (smokeOffscreen) mainWindow.webContents.setFrameRate(30);
  mainWindow.webContents.session.setSpellCheckerEnabled(!!getAppSettings().spellcheck);

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
    // 冒烟：IML_SMOKE_QUERY=settings 时主窗口直接加载对应的独立页面，方便截图
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
 * 设置 / 关于 / 快捷键都是主窗口里的浮层，不再新开 BrowserWindow：
 * 多开窗口会让 Dock 与调度中心里出现好几个同名窗口。主窗口不在时先建出来再打开。
 */
function openDialogInMain(id: 'about' | 'shortcuts' | 'settings') {
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
      label: APP_NAME,
      submenu: [
        { label: `关于 ${APP_NAME}`, click: () => openDialogInMain('about') },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: () => openDialogInMain('settings') },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${APP_NAME}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${APP_NAME}` },
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
        {
          label: '打开文件夹…',
          accelerator: 'Cmd+Shift+O',
          click: () => mainWindow?.webContents.send('menu:open-folder'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'Cmd+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        {
          label: '导出为 PDF…',
          accelerator: 'Cmd+P',
          click: () => mainWindow?.webContents.send('menu:export', 'pdf'),
        },
        {
          label: '导出为 HTML…',
          accelerator: 'Cmd+Shift+E',
          click: () => mainWindow?.webContents.send('menu:export', 'html'),
        },
        { label: '导出为 Word…', click: () => mainWindow?.webContents.send('menu:export', 'docx') },
        { label: '导出为长图…', click: () => mainWindow?.webContents.send('menu:export', 'image') },
        { type: 'separator' },
        // 标签页是渲染进程管的，但 Cmd+W 得在这里占住：否则 role:'close' 会拿走它去关窗口
        {
          label: '关闭标签页',
          accelerator: 'Cmd+W',
          click: () => mainWindow?.webContents.send('menu:close-tab'),
        },
        {
          label: '关闭其他标签页',
          accelerator: 'Alt+Cmd+W',
          click: () => mainWindow?.webContents.send('menu:close-other-tabs'),
        },
        {
          label: '关闭已保存的标签页',
          click: () => mainWindow?.webContents.send('menu:close-saved-tabs'),
        },
        {
          label: '关闭全部标签页',
          click: () => mainWindow?.webContents.send('menu:close-all-tabs'),
        },
        {
          label: '重开刚关的标签页',
          accelerator: 'Cmd+Shift+T',
          click: () => mainWindow?.webContents.send('menu:reopen-tab'),
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口', accelerator: 'Cmd+Shift+W' },
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
  // 0. 本地图片协议
  try {
    handleAssetProtocol();
  } catch (err) {
    console.error('Failed to register asset protocol:', err);
  }

  // 1. 注册核心 IPC 句柄
  try {
    setupFileSystemIPC();
  } catch (err) {
    console.error('Failed to setup FileSystem IPC:', err);
  }

  // ── 文件夹监听：外部（同步盘 / 其他编辑器）改动 → 通知渲染进程刷新树、重载未修改的标签页。传空 = 停止监听 ──
  ipcMain.handle('folder:watch', (_event, dirPath: string | null) => {
    if (folderWatcher) {
      folderWatcher.close();
      folderWatcher = null;
    }
    if (!dirPath || !fs.existsSync(dirPath)) return false;
    try {
      folderWatcher = fs.watch(dirPath, { recursive: true }, (_type, filename) => {
        if (!filename) return;
        const rel = filename.toString();
        // 隐藏文件（.DS_Store、同步盘的临时文件等）不触发
        if (rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) return;
        folderChanged.add(path.join(dirPath, rel));
        if (folderChangeTimer) clearTimeout(folderChangeTimer);
        folderChangeTimer = setTimeout(() => {
          const paths = [...folderChanged];
          folderChanged.clear();
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('folder:changed', paths);
        }, 400);
      });
      folderWatcher.on('error', (err) => console.warn('[folder:watch]', err));
      return true;
    } catch (err) {
      console.warn('[folder:watch] failed:', err);
      return false;
    }
  });

  // 粘贴链接时取网页标题
  ipcMain.handle('web:fetchTitle', (_event, url: string) => fetchPageTitle(String(url || '')));
  // 导出长图时取网上的图片
  ipcMain.handle('web:fetchImage', (_event, url: string) => fetchImageBytes(String(url || '')));

  // 设置窗口请求清空会话 → 由主窗口执行（会话只存在于主窗口的 localStorage）
  ipcMain.on('app:clearSession', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('session:clear');
  });

  // App Settings IPC
  ipcMain.handle('app:getSettings', () => getAppSettings());
  ipcMain.handle('app:saveSettings', (_event, settings) => {
    const result = saveAppSettings(settings);
    if (result.success) applySpellcheck(!!getAppSettings().spellcheck);
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
    const icon = nativeImage.createFromPath(path.join(process.cwd(), 'assets/lite/icon-1024.png'));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  createWindow();
  
  ipcMain.on('open-about', () => openDialogInMain('about'));
  ipcMain.on('open-shortcuts', () => openDialogInMain('shortcuts'));
  ipcMain.on('open:settings', () => openDialogInMain('settings'));

  // Forward settings preview/revert from settings window to main window
  ipcMain.on('settings:preview', (_event, settings) => {
    if (mainWindow) mainWindow.webContents.send('settings:preview', settings);
  });
  ipcMain.on('settings:revert', () => {
    if (mainWindow) mainWindow.webContents.send('settings:revert');
  });

  ipcMain.handle('open-url', async (_event, url: string) => { shell.openExternal(url); });
  
  // App Update Check IPC。翻最近的发布里带自己前缀的（不用 /releases/latest：老版本和「iML 笔记」同仓库时就是这么认的，保持一致）
  ipcMain.handle('app:checkUpdates', async () => {
    try {
      const response = await fetch('https://api.github.com/repos/imoling/iml-editor-lite/releases?per_page=40', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'iML-Editor'
        }
      });

      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

      const release = pickLatestRelease(await response.json(), RELEASE_TAG_PREFIX);
      if (!release) return { success: false, error: '未发现任何发布版本' };
      return describeRelease(release, process.platform, process.arch, RELEASE_TAG_PREFIX);
    } catch (err: any) {
      console.error('Update check failed:', err);
      return { success: false, error: '无法连接到更新服务器，请检查网络设置' };
    }
  });

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
