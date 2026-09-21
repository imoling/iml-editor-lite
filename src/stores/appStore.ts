import { create } from 'zustand';
import { isNewerVersion } from '../utils/version';
import type { UpdateInfo } from '../types/window';
import { deriveNoteTitle } from '../utils/noteTitle';
import { FileSortMode, DEFAULT_FILE_SORT, isFileSortMode } from '../utils/fileSort';

const FILE_SORT_KEY = 'iml.fileSort';

export type DialogId = 'about' | 'shortcuts' | 'settings';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  /** 修改 / 创建时间（毫秒）；拿不到时是 0 或没有 */
  mtime?: number;
  ctime?: number;
}

export interface Tab {
  id: string; // filePath
  title: string;
  content: string;
  isDirty: boolean;
  mode: 'word' | 'markdown';
  /** 磁盘上的文件被外部改动（或删除）而本标签页有未保存修改，需要用户决定 */
  externallyModified?: boolean;
  /** 上次从磁盘读到 / 写进磁盘的内容的指纹：用来分清「磁盘真的被别人改了」和「只是我这边打了字、磁盘没动」 */
  diskSig?: string;
}

/** 内容指纹：长度 + FNV-1a。只用来判断「和上次是不是同一份」，不需要防碰撞的强度 */
export function contentSig(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/**
 * 关掉这个标签页之前要不要先问一句。
 * 空白的未命名文档直接关（用户并没有写下任何东西）；写了内容的未命名文档、
 * 以及改过还没存的已有文件，都要问。关闭标签页的所有入口共用这一条规则。
 */
export function needsSavePrompt(tab: Tab): boolean {
  return tab.id.startsWith('new-') ? !!tab.content.trim() : tab.isDirty;
}

export interface HeadingNode {
  level: number;
  text: string;
  id: string;
}

export interface ThemeConfig {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  gradient: string;
  shadow: string;
}

export const THEME_PRESETS: ThemeConfig[] = [
  {
    id: 'indigo',
    name: '经典靛紫',
    primary: '#6366F1',
    secondary: '#8B5CF6',
    gradient: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
    shadow: 'rgba(99, 102, 241, 0.2)',
  },
  {
    id: 'ocean',
    name: '深海极客',
    primary: '#0EA5E9',
    secondary: '#6366F1',
    gradient: 'linear-gradient(135deg, #0EA5E9 0%, #6366F1 100%)',
    shadow: 'rgba(14, 165, 233, 0.2)',
  },
  {
    id: 'mint',
    name: '清新薄荷',
    primary: '#10B981',
    secondary: '#3B82F6',
    gradient: 'linear-gradient(135deg, #10B981 0%, #3B82F6 100%)',
    shadow: 'rgba(16, 185, 129, 0.2)',
  },
  {
    id: 'rose',
    name: '落日玫瑰',
    primary: '#F43F5E',
    secondary: '#FB923C',
    gradient: 'linear-gradient(135deg, #F43F5E 0%, #FB923C 100%)',
    shadow: 'rgba(244, 63, 94, 0.2)',
  },
  {
    id: 'obsidian',
    name: '曜石黑金',
    primary: '#334155',
    secondary: '#94A3B8',
    gradient: 'linear-gradient(135deg, #334155 0%, #94A3B8 100%)',
    shadow: 'rgba(51, 65, 85, 0.2)',
  }
];

export interface NavigationRequest {
  heading?: HeadingNode;
  /** 跳到以 `^块ID` 结尾的那一段 */
  blockId?: string;
  /** 源码模式按行号跳，富文本按这一行的文字找 */
  line?: number;
  lineText?: string;
  timestamp: number;
}

/** 状态栏提示上的按钮（「打开」「在访达中显示」……）；点过就收起提示 */
export interface NoticeAction { label: string; run: () => void }
export type SidebarTab = 'files' | 'outline';

/** 正文排版：字体、字号、行距、页宽（富文本与预览共用） */
export interface EditorPrefs {
  font: 'system' | 'serif' | 'kai' | 'mono';
  fontSize: number;
  lineHeight: number;
  pageWidth: 'narrow' | 'medium' | 'wide' | 'full';
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = { font: 'system', fontSize: 16, lineHeight: 1.6, pageWidth: 'medium' };

export const EDITOR_FONTS: Record<EditorPrefs['font'], { label: string; stack: string }> = {
  system: { label: '系统默认', stack: 'var(--font-body)' },
  serif: { label: '宋体 / 衬线', stack: '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", "SimSun", Georgia, serif' },
  kai: { label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif' },
  mono: { label: '等宽', stack: 'var(--font-code)' },
};

export const PAGE_WIDTHS: Record<EditorPrefs['pageWidth'], { label: string; css: string }> = {
  narrow: { label: '窄', css: '700px' },
  medium: { label: '适中', css: '820px' },
  wide: { label: '宽', css: '1040px' },
  full: { label: '铺满', css: '100%' },
};

export function normalizeEditorPrefs(raw: any): EditorPrefs {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    font: r.font in EDITOR_FONTS ? r.font : DEFAULT_EDITOR_PREFS.font,
    fontSize: Math.min(22, Math.max(13, Number(r.fontSize) || DEFAULT_EDITOR_PREFS.fontSize)),
    lineHeight: Math.min(2.4, Math.max(1.3, Number(r.lineHeight) || DEFAULT_EDITOR_PREFS.lineHeight)),
    pageWidth: r.pageWidth in PAGE_WIDTHS ? r.pageWidth : DEFAULT_EDITOR_PREFS.pageWidth,
  };
}

/** 把排版设置写成 CSS 变量（设置弹窗里拖动时实时预览也走这里） */
export function applyEditorPrefs(prefs: EditorPrefs) {
  const root = document.documentElement;
  root.style.setProperty('--editor-font', EDITOR_FONTS[prefs.font].stack);
  root.style.setProperty('--editor-font-size', `${prefs.fontSize}px`);
  root.style.setProperty('--editor-line-height', String(prefs.lineHeight));
  root.style.setProperty('--editor-page-width', PAGE_WIDTHS[prefs.pageWidth].css);
}

export interface SearchState {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  /** 当前文档中的匹配总数 */
  total: number;
  /** 当前定位到第几个匹配（从 1 开始，0 表示无） */
  current: number;
}

export interface SearchCommand {
  type: 'next' | 'prev' | 'replace' | 'replaceAll';
}

export interface AppState {
  mode: 'word' | 'markdown';
  activeTabId: string | null;
  tabs: Tab[];
  workspacePath: string | null;
  workspaceName: string | null;
  fileTree: FileNode[];
  sidebarVisible: boolean;
  toolbarVisible: boolean;
  statusBarVisible: boolean;
  recentFiles: string[];
  outline: HeadingNode[];
  findVisible: boolean;
  replaceVisible: boolean;
  search: SearchState;
  searchCommand: SearchCommand | null;
  /** 当前编辑器注册的「把未写回的内容立刻同步到 store」钩子（保存 / 导出 / 关窗前调用） */
  editorFlush: (() => void) | null;
  /** 编辑器里当前选中的文字；没有选区时是空串。状态栏据此显示「选中 N 字」 */
  selectionText: string;
  setSelectionText: (text: string) => void;
  /** 最近一次「不是编辑器自己打的字」的改写。富文本编辑器看到 rev 变了就重载这篇，哪怕光标正在里面 */
  externalWrite: { id: string; rev: number } | null;
  sidebarTab: SidebarTab;
  /** 状态栏里一闪而过的提示（图片压缩了多少、导出到了哪……）；带按钮的会多停留一会儿 */
  notice: { id: number; text: string; actions?: NoticeAction[] } | null;
  /** 专注模式：收起侧边栏与工具栏，当前段落以外的内容淡出，光标所在行保持在屏幕中间 */
  focusMode: boolean;
  sidebarWidth: number;
  /** 文件树的排序方式（文件夹总在前、按名称）；记在 localStorage 里 */
  fileSort: FileSortMode;
  expandedPaths: string[];
  navigationRequest: NavigationRequest | null;
  updateStatus: {
    show: boolean;
    loading: boolean;
    latestVersion: string | null;
    error: string | null;
    /** 最新版本的说明、Release 页面、这台电脑对应的安装包 */
    release?: Pick<UpdateInfo, 'notes' | 'releaseUrl' | 'download'> | null;
  };
  /** 当前打开的弹窗（设置 / 关于 / 快捷键都在主窗口内以浮层显示，不再新开窗口） */
  dialog: DialogId | null;
  zoom: number;
  theme: ThemeConfig;
  appearanceMode: 'light' | 'dark' | 'system' | 'eye-protection';
  /** 启动时：恢复上次的标签页，还是一篇空白文档 */
  startupBehavior: 'restore' | 'blank';
  /** 失焦时把已有的文件存盘（默认关：和记事本一样，存不存你说了算） */
  autoSave: boolean;
  /** 粘贴 / 拖入的图片压缩成 WebP 再存盘 */
  imageCompression: boolean;
  /** 粘贴网址时自动取网页标题 */
  fetchLinkTitle: boolean;
  spellcheck: boolean;
  editorPrefs: EditorPrefs;

  // File Management State
  selectedNodePath: string | null;
  renamingPath: string | null;
  contextMenu: { visible: boolean; x: number; y: number; node: FileNode | null };

  // Actions
  toggleMode: () => void;
  setActiveTab: (id: string | null) => void;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  /** 关标签页的统一入口：脏文档先弹确认，干净的直接关 */
  requestCloseTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  /** 关掉所有没有未保存修改的标签页 */
  closeSavedTabs: () => void;
  closeAllTabs: () => void;
  /** 批量关闭时还在排队等用户决定的标签页 */
  pendingCloseIds: string[];
  advanceCloseQueue: () => void;
  cancelCloseQueue: () => void;
  /** 最近关掉的文件路径（栈顶是最后关的），供 ⌘⇧T 用 */
  closedTabs: string[];
  /** ⌘⇧T：重新打开最近关掉的那个标签页 */
  reopenClosedTab: () => Promise<void>;
  updateTabContent: (id: string, content: string) => void;
  /** 由编辑器之外的功能改写一篇文档：先把编辑器里还没写回的字刷进来，再基于最新内容改。文档已经关掉时返回 false */
  editTabContent: (id: string, edit: (current: string) => string) => boolean;
  /** 打开一个文件夹作为侧边栏的文件树，并开始监听目录变化 */
  loadFolder: (path: string) => Promise<void>;
  /** 收起文件树（不影响已经打开的标签页） */
  closeFolder: () => void;
  /** 在指定目录新建文档并进入重命名 */
  createNoteIn: (dirPath: string) => Promise<string | null>;
  createFolderIn: (dirPath: string) => Promise<string | null>;
  /** 文件树里新建时的目标目录：选中的文件夹（或选中文件所在目录），否则打开的文件夹；没打开文件夹时是空串 */
  getNewNoteDir: () => string;
  /** 这些路径可能被外部改动了（文件夹监听的通知，或窗口重新拿到焦点时把打开的文件都查一遍） */
  handleExternalChanges: (paths: string[]) => Promise<void>;
  updateFileNode: (path: string, updates: Partial<FileNode>) => void;
  updateTabId: (oldId: string, newId: string, newTitle: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  revealInSidebar: (path: string) => Promise<void>;
  scrollToHeading: (heading: HeadingNode) => void;
  
  // UI Actions
  toggleSidebar: () => void;
  toggleToolbar: () => void;
  toggleStatusBar: () => void;
  setOutline: (headings: HeadingNode[]) => void;
  addToRecent: (path: string) => void;
  createNewFile: () => void;
  toggleFind: () => void;
  toggleReplace: () => void;
  closeSearch: () => void;
  setSearch: (patch: Partial<SearchState>) => void;
  setSearchCounts: (total: number, current: number) => void;
  sendSearchCommand: (type: SearchCommand['type']) => void;
  /** 编辑器处理完命令后清掉，避免切换编辑模式时新挂载的编辑器重放（例如再来一次「全部替换」） */
  consumeSearchCommand: () => void;
  registerEditorFlush: (fn: (() => void) | null) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  /** 状态栏里的一行提示；报错类的可以给长一点的停留时间。带按钮（「打开」「在访达中显示」这类）的默认停 15 秒，给人时间点 */
  notify: (text: string, ms?: number, actions?: NoticeAction[]) => void;
  toggleFocusMode: () => void;
  /** 用给定关键词打开文档内查找 */
  showFindWith: (query: string) => void;
  setSidebarWidth: (width: number) => void;
  setFileSort: (mode: FileSortMode) => void;
  refreshWorkspace: () => Promise<void>;
  openFileByPath: (filePath: string) => Promise<void>;
  openFile: () => Promise<void>;
  openDirectory: () => Promise<void>;
  tabToClose: string | null;
  setTabToClose: (id: string | null) => void;
  saveActiveFile: (saveAs?: boolean, isAutoSave?: boolean) => Promise<boolean>;
  checkUpdates: () => Promise<void>;
  autoCheckUpdates: () => Promise<void>;
  setUpdateStatus: (status: Partial<AppState['updateStatus']>) => void;
  openDialog: (id: DialogId) => void;
  closeDialog: () => void;
  setZoom: (zoom: number) => void;
  setTheme: (themeId: string) => void;
  setAppearanceMode: (mode: 'light' | 'dark' | 'system' | 'eye-protection') => void;
  setStartupBehavior: (behavior: 'restore' | 'blank') => void;
  setAutoSave: (autoSave: boolean) => void;
  loadSession: () => Promise<boolean>;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  applyAppearance: (mode: 'light' | 'dark' | 'system' | 'eye-protection') => void;

  // File Management Actions
  setSelectedNodePath: (path: string | null) => void;
  setRenamingPath: (path: string | null) => void;
  setContextMenu: (contextMenu: Partial<AppState['contextMenu']>) => void;
  renameFile: (oldPath: string, newName: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<boolean>;
  duplicateFile: (path: string) => Promise<boolean>;
}

/** 一篇空白的未命名文档。没有欢迎页：启动时、关掉最后一个标签页之后，看到的都是它 */
function blankTab(): Tab {
  return { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.md`, title: '未命名', content: '', isDirty: false, mode: 'word' };
}

/** 还没动过的空白文档：打开别的文件时顺手把它换掉，不留一个没用的「未命名」标签 */
const isPristineBlank = (tab: Tab) => tab.id.startsWith('new-') && !tab.content && !tab.isDirty;

/** 路径分隔符：出现反斜杠即按 Windows 处理（dialog / path.join 在 Windows 上一律给反斜杠） */
function pathSep(p: string): '/' | '\\' {
  return p.includes('\\') ? '\\' : '/';
}

const NOTE_FILE_RE = /\.(md|markdown|mdown|mkd|txt)$/i;

/** 读取文件夹：隐藏文件与非文档文件（图片、附件等）不进树，子文件夹全部保留 */
export async function readLibraryDir(dirPath: string): Promise<FileNode[] | null> {
  const result = await window.api.fs.readDir(dirPath);
  if (!result.success || !result.files) return null;
  return (result.files as FileNode[]).filter(
    (f) => !f.name.startsWith('.') && (f.isDirectory || NOTE_FILE_RE.test(f.name)),
  );
}

function findNode(nodes: FileNode[], targetPath: string): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  mode: 'word',
  activeTabId: null,
  tabs: [],
  workspacePath: null,
  workspaceName: null,
  fileTree: [],
  sidebarVisible: false,
  toolbarVisible: true,
  statusBarVisible: true,
  recentFiles: [],
  outline: [],
  findVisible: false,
  replaceVisible: false,
  search: { query: '', replacement: '', caseSensitive: false, total: 0, current: 0 },
  searchCommand: null,
  editorFlush: null,
  selectionText: '',
  setSelectionText: (text) => { if (get().selectionText !== text) set({ selectionText: text }); },
  externalWrite: null,
  sidebarTab: 'files',
  notice: null,
  focusMode: false,
  sidebarWidth: 240,
  fileSort: (() => { try { const v = localStorage.getItem(FILE_SORT_KEY); return isFileSortMode(v) ? v : DEFAULT_FILE_SORT; } catch { return DEFAULT_FILE_SORT; } })(),
  expandedPaths: [],
  navigationRequest: null,
  tabToClose: null,
  pendingCloseIds: [],
  closedTabs: [],
  
  // File Management Default State
  selectedNodePath: null,
  renamingPath: null,
  contextMenu: { visible: false, x: 0, y: 0, node: null },
  
  updateStatus: { show: false, loading: false, latestVersion: null, error: null },
  dialog: null,
  zoom: 100,
  theme: THEME_PRESETS[0],
  appearanceMode: 'light',
  startupBehavior: 'restore',
  autoSave: false,
  imageCompression: true,
  fetchLinkTitle: true,
  spellcheck: false,
  editorPrefs: DEFAULT_EDITOR_PREFS,

  setTabToClose: (id: string | null) => set({ tabToClose: id }),
  
  toggleMode: () => set((state) => ({ 
    mode: state.mode === 'word' ? 'markdown' : 'word' 
  })),
  
  setActiveTab: async (id: string | null) => {
    set({ activeTabId: id });
    if (!id || id.startsWith('new-')) return;
    get().addToRecent(id);
    // 文件在打开的文件夹里就展开定位；不在的只在标签页里打开，不动树
    await get().revealInSidebar(id);
  },
  
  openTab: (tab: Tab) => {
    const state = get();
    const exists = state.tabs.find((t) => t.id === tab.id);
    if (!exists) {
      // 只开着一篇没动过的空白文档时，新打开的文件直接顶替它（Notepad++ 的做法）
      const onlyBlank = state.tabs.length === 1 && isPristineBlank(state.tabs[0]);
      set({ tabs: onlyBlank ? [tab] : [...state.tabs, tab] });
    }
    get().setActiveTab(tab.id);
  },
  
  requestCloseTab: (id: string) => get().closeTabs([id]),

  /**
   * 批量关闭：干净的立刻关掉，需要问的排成队列逐个弹确认框。
   * 「关闭其他 / 右侧 / 全部」都走这里，省得每处各写一遍脏文档的判断。
   */
  closeTabs: (ids: string[]) => {
    const state = get();
    const asking: string[] = [];
    for (const id of ids) {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) continue;
      if (needsSavePrompt(tab)) asking.push(id);
      else get().closeTab(id);
    }
    if (asking.length > 0) set({ tabToClose: asking[0], pendingCloseIds: asking.slice(1) });
  },

  /** 确认框处理完一个后叫一次，轮到队列里的下一个 */
  advanceCloseQueue: () => set((state) => ({
    tabToClose: state.pendingCloseIds[0] ?? null,
    pendingCloseIds: state.pendingCloseIds.slice(1),
  })),

  /** 在确认框上点「取消」= 放弃整批，而不是只跳过这一个 */
  cancelCloseQueue: () => set({ tabToClose: null, pendingCloseIds: [] }),

  closeOtherTabs: (id: string) => get().closeTabs(get().tabs.filter((t) => t.id !== id).map((t) => t.id)),

  closeTabsToRight: (id: string) => {
    const tabs = get().tabs;
    const at = tabs.findIndex((t) => t.id === id);
    if (at < 0) return;
    get().closeTabs(tabs.slice(at + 1).map((t) => t.id));
  },

  /** 只关没有未保存修改的，永远不会弹确认框 */
  closeSavedTabs: () => get().closeTabs(get().tabs.filter((t) => !needsSavePrompt(t)).map((t) => t.id)),

  closeAllTabs: () => get().closeTabs(get().tabs.map((t) => t.id)),

  reopenClosedTab: async () => {
    const stack = [...get().closedTabs];
    while (stack.length > 0) {
      const path = stack.pop()!;
      set({ closedTabs: stack });
      if (get().tabs.some((t) => t.id === path)) continue;   // 已经又打开了就跳过
      await get().openFileByPath(path);
      return;
    }
  },

  closeTab: (id: string) => set((state) => {
    // 记下刚关掉的真实文件，⌘⇧T 能原路开回来；未命名文档没有路径，开不回来
    const closedTabs = id.startsWith('new-')
      ? state.closedTabs
      : [...state.closedTabs.filter((p) => p !== id), id].slice(-10);
    const newTabs = state.tabs.filter((t) => t.id !== id);
    const newActiveId = state.activeTabId === id 
      ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
      : state.activeTabId;
    
    // 关掉最后一个标签页：回到一篇空白文档（没有欢迎页；最近打开的文件在「文件」菜单里）。文件树留着，不随文档关闭而消失
    if (newTabs.length === 0) {
      const blank = blankTab();
      return { tabs: [blank], activeTabId: blank.id, outline: [], closedTabs };
    }

    return {
      tabs: newTabs,
      activeTabId: newActiveId,
      closedTabs
    };
  }),

  updateTabContent: (id: string, content: string) => {
    const target = get().tabs.find(t => t.id === id);
    // 内容没变就不动，避免把未编辑的文件标脏
    if (!target || target.content === content) return;
    set((state) => ({
      tabs: state.tabs.map(t => t.id === id ? { ...t, content, isDirty: true } : t)
    }));
  },

  editTabContent: (id, edit) => {
    get().editorFlush?.();
    const target = get().tabs.find(t => t.id === id);
    if (!target) return false;
    const content = edit(target.content);
    if (content === target.content) return true;
    set((state) => ({
      tabs: state.tabs.map(t => t.id === id ? { ...t, content, isDirty: true } : t),
      externalWrite: { id, rev: (state.externalWrite?.rev ?? 0) + 1 },
    }));
    return true;
  },

  updateTabId: (oldId: string, newId: string, newTitle: string) => set((state) => {
    const newTabs = state.tabs.map(t => t.id === oldId ? { ...t, id: newId, title: newTitle, isDirty: false } : t);
    const newState = {
      tabs: newTabs,
      activeTabId: state.activeTabId === oldId ? newId : state.activeTabId
    };
    return newState;
  }),

  loadFolder: async (folderPath: string) => {
    if (!folderPath) return;
    const files = await readLibraryDir(folderPath);
    if (!files) {
      console.warn('Folder not readable:', folderPath);
      return;
    }
    set({
      workspacePath: folderPath,
      workspaceName: folderPath.split(/[/\\]/).filter(Boolean).pop() || '文件夹',
      fileTree: files,
      expandedPaths: [...new Set([folderPath, ...get().expandedPaths])],
    });
    // 已展开的子目录补加载子节点
    await get().refreshWorkspace();
    window.api.folder.watch(folderPath).catch(() => {});
  },

  closeFolder: () => {
    set({ workspacePath: null, workspaceName: null, fileTree: [], selectedNodePath: null });
    window.api.folder.watch(null).catch(() => {});
  },

  getNewNoteDir: () => {
    const { selectedNodePath, fileTree, workspacePath } = get();
    if (selectedNodePath && workspacePath) {
      const node = findNode(fileTree, selectedNodePath);
      if (node?.isDirectory) return node.path;
      if (node) return selectedNodePath.substring(0, selectedNodePath.lastIndexOf(pathSep(selectedNodePath)));
    }
    return workspacePath || '';
  },

  createNoteIn: async (dirPath: string) => {
    const sep = pathSep(dirPath);
    const base = '未命名';
    let filePath = `${dirPath}${sep}${base}.md`;
    for (let i = 2; await window.api.fs.exists(filePath); i++) filePath = `${dirPath}${sep}${base} ${i}.md`;
    const res = await window.api.fs.writeFile(filePath, '');
    if (!res.success) return null;
    await get().refreshWorkspace();
    get().openTab({ id: filePath, title: filePath.split(sep).pop() || base, content: '', isDirty: false, mode: 'word' });
    set({ selectedNodePath: filePath, renamingPath: filePath });
    return filePath;
  },

  createFolderIn: async (dirPath: string) => {
    const sep = pathSep(dirPath);
    const base = '新建文件夹';
    let folderPath = `${dirPath}${sep}${base}`;
    for (let i = 2; await window.api.fs.exists(folderPath); i++) folderPath = `${dirPath}${sep}${base} ${i}`;
    const res = await window.api.fs.mkdir(folderPath);
    if (!res.success) return null;
    set({ expandedPaths: [...new Set([...get().expandedPaths, dirPath])] });
    await get().refreshWorkspace();
    set({ selectedNodePath: folderPath, renamingPath: folderPath });
    return folderPath;
  },

  handleExternalChanges: async (paths: string[]) => {
    await get().refreshWorkspace();
    const changed = new Set(paths);
    for (const tab of get().tabs) {
      if (tab.id.startsWith('new-') || !changed.has(tab.id)) continue;
      const result = await window.api.fs.readFile(tab.id);
      const mark = (patch: Partial<Tab>) =>
        set((state) => ({ tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, ...patch } : t)) }));
      if (!result.success) {
        mark({ externallyModified: true }); // 被外部删除 / 移动
        continue;
      }
      const diskContent = result.content || '';
      if (diskContent === tab.content) continue;
      // 磁盘上还是我们上次读到 / 写进去的那一份：不是别人改了文件，只是这边打了字还没存。
      // 典型场景是在文件树里新建文件 → 打开 → 用户马上开始打字，文件监听的通知这时才到
      if (tab.diskSig && tab.diskSig === contentSig(diskContent)) continue;
      if (tab.isDirty) {
        mark({ externallyModified: true, diskSig: contentSig(diskContent) }); // 两边都改了，交给用户决定（保存即覆盖）
      } else {
        mark({ content: diskContent, isDirty: false, externallyModified: false, diskSig: contentSig(diskContent) }); // 未改动的标签页静默跟随磁盘
      }
    }
  },

  updateFileNode: (path: string, updates: Partial<FileNode>) => set((state) => {
    const updateRecursive = (nodes: FileNode[]): FileNode[] => {
      return nodes.map(node => {
        if (node.path === path) return { ...node, ...updates };
        if (node.children) return { ...node, children: updateRecursive(node.children) };
        return node;
      });
    };
    return { fileTree: updateRecursive(state.fileTree) };
  }),

  setExpanded: (path: string, expanded: boolean) => set((state) => ({
    expandedPaths: expanded 
      ? [...new Set([...state.expandedPaths, path])]
      : state.expandedPaths.filter(p => p !== path)
  })),

  revealInSidebar: async (path: string) => {
    const { workspacePath } = get();
    if (!workspacePath) return;
    const sep = pathSep(path);
    if (!path.startsWith(workspacePath + sep)) return;

    // 工作区根到文件所在目录之间的每一级：展开，并在子节点尚未加载时读取目录
    const segments = path.slice(workspacePath.length + 1).split(sep);
    segments.pop(); // 去掉文件名
    const expanded = new Set(get().expandedPaths);
    expanded.add(workspacePath);
    let current = workspacePath;
    for (const segment of segments) {
      current = current + sep + segment;
      expanded.add(current);
      const node = findNode(get().fileTree, current);
      if (node?.isDirectory && (!node.children || node.children.length === 0)) {
        try {
          const files = await readLibraryDir(current);
          if (files) get().updateFileNode(current, { children: files });
        } catch (error) {
          console.error('Failed to load directory for reveal:', error);
        }
      }
    }
    set({ expandedPaths: [...expanded] });
  },

  scrollToHeading: (heading: HeadingNode) => set({ 
    navigationRequest: { heading, timestamp: Date.now() } 
  }),

  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  toggleToolbar: () => set((state) => ({ toolbarVisible: !state.toolbarVisible })),
  toggleStatusBar: () => set((state) => ({ statusBarVisible: !state.statusBarVisible })),
  
  setOutline: (outline: HeadingNode[]) => set({ outline }),
  
  addToRecent: (path: string) => set((state) => ({
    recentFiles: [path, ...state.recentFiles.filter(p => p !== path)].slice(0, 10)
  })),

  createNewFile: () => get().openTab(blankTab()),

  // ⌘F：未开 → 开查找；开着替换 → 收起替换行；只开着查找 → 关闭（并清除高亮）
  toggleFind: () => {
    const { findVisible, replaceVisible } = get();
    if (!findVisible) set({ findVisible: true, replaceVisible: false });
    else if (replaceVisible) set({ replaceVisible: false });
    else get().closeSearch();
  },
  // ⌥⌘F：未开 → 开查找+替换；已开 → 关闭
  toggleReplace: () => {
    if (!get().replaceVisible) set({ findVisible: true, replaceVisible: true });
    else get().closeSearch();
  },
  closeSearch: () => set((state) => ({
    findVisible: false,
    replaceVisible: false,
    searchCommand: null,
    search: { ...state.search, query: '', total: 0, current: 0 },
  })),
  setSearch: (patch) => set((state) => ({ search: { ...state.search, ...patch } })),
  setSearchCounts: (total, current) => {
    const s = get().search;
    if (s.total === total && s.current === current) return;
    set({ search: { ...s, total, current } });
  },
  sendSearchCommand: (type) => set({ searchCommand: { type } }),
  consumeSearchCommand: () => { if (get().searchCommand) set({ searchCommand: null }); },
  registerEditorFlush: (fn) => set({ editorFlush: fn }),
  showFindWith: (query) => set((state) => ({ findVisible: true, replaceVisible: false, search: { ...state.search, query } })),
  notify: (text, ms, actions) => {
    const id = Date.now();
    set({ notice: actions?.length ? { id, text, actions } : { id, text } });
    setTimeout(() => { if (get().notice?.id === id) set({ notice: null }); }, ms ?? (actions?.length ? 15000 : 5000));
  },
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  setSidebarTab: (tab: SidebarTab) => {
    const { sidebarTab, sidebarVisible } = get();
    if (sidebarVisible && sidebarTab === tab) {
      set({ sidebarVisible: false });
    } else {
      set({ sidebarTab: tab, sidebarVisible: true });
    }
  },
  setSidebarWidth: (width) => set({ sidebarWidth: Math.min(600, Math.max(240, width)) }),
  setFileSort: (mode) => { try { localStorage.setItem(FILE_SORT_KEY, mode); } catch { /* 记不住也不影响这次排序 */ } set({ fileSort: mode }); },
  refreshWorkspace: async () => {
    const { workspacePath, expandedPaths } = get();
    if (!workspacePath) return;

    try {
      const rootFiles = await readLibraryDir(workspacePath);
      if (!rootFiles) return;
      // 已展开的目录逐层重新读取，刷新后树的展开状态和子节点都不丢
      const loadExpanded = async (nodes: FileNode[]): Promise<FileNode[]> =>
        Promise.all(nodes.map(async (node) => {
          if (!node.isDirectory || !expandedPaths.includes(node.path)) return node;
          const sub = await readLibraryDir(node.path);
          if (!sub) return node;
          return { ...node, children: await loadExpanded(sub) };
        }));
      set({ fileTree: await loadExpanded(rootFiles) });
    } catch (error) {
      console.error('Failed to refresh workspace:', error);
    }
  },

  openFileByPath: async (filePath: string) => {
    const existing = get().tabs.find(t => t.id === filePath);
    if (existing) { get().setActiveTab(filePath); return; }
    const readResult = await window.api.fs.readFile(filePath);
    if (readResult.success) {
      get().openTab({
        id: filePath,
        title: filePath.split(/[/\\]/).pop() || 'Untitled',
        content: readResult.content || '',
        isDirty: false,
        mode: 'word',
        diskSig: contentSig(readResult.content || ''),
      });
      get().addToRecent(filePath);
    }
  },

  openFile: async () => {
    const result = await window.api.dialog.open({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }]
    });

    for (const filePath of result || []) await get().openFileByPath(filePath);
  },

  // 打开文件夹：选一个目录作为侧边栏的文件树，并把侧边栏亮出来
  openDirectory: async () => {
    const result = await window.api.dialog.open({ properties: ['openDirectory'] });
    if (result && result.length > 0) {
      await get().loadFolder(result[0]);
      set({ sidebarTab: 'files', sidebarVisible: true });
    }
  },

  saveActiveFile: async (saveAs = false, isAutoSave = false) => {
    // 编辑器的写回是防抖的，保存前先把屏幕上的最新内容刷进 store
    get().editorFlush?.();
    const { activeTabId, tabs } = get();
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return false;

    let filePath = activeTab.id;
    const isTempFile = filePath.startsWith('new-');
    // 失焦触发的静默保存：没改过就不写盘。否则只是点开看一眼，文件的修改时间也会变，同步盘跟着重传一遍
    if (isAutoSave && !isTempFile && !activeTab.isDirty) return true;

    if (isTempFile || saveAs) {
      // 未命名文档从不悄悄建成文件：内容随会话保存着，存到哪、叫什么，由用户在保存框里定
      if (isTempFile && isAutoSave) return false;
      // 保存框里先替用户想一个名字（正文第一行），位置默认在打开的文件夹里
      const dir = get().getNewNoteDir();
      const name = `${deriveNoteTitle(activeTab.content) || '未命名'}.md`;
      const result = await window.api.dialog.save({
        defaultPath: isTempFile ? (dir ? `${dir}${pathSep(dir)}${name}` : name) : filePath,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (!result) return false;
      filePath = result;
    }

    const saveResult = await window.api.fs.writeFile(filePath, activeTab.content);
    if (saveResult.success) {
      if (isTempFile || saveAs) {
        await get().updateTabId(activeTab.id, filePath, filePath.split(/[\\\\/]/).pop() || 'Untitled');
        get().setActiveTab(filePath);
        if (get().workspacePath && filePath.startsWith(get().workspacePath!)) {
          get().refreshWorkspace();
        }
      } else {
        set((state) => ({
          tabs: state.tabs.map(t => t.id === filePath ? { ...t, isDirty: false, externallyModified: false, diskSig: contentSig(activeTab.content) } : t)
        }));
      }
      return true;
    }
    return false;
  },

  setUpdateStatus: (status: Partial<AppState['updateStatus']>) => set((state) => ({
    updateStatus: { ...state.updateStatus, ...status }
  })),

  openDialog: (id) => set({ dialog: id }),
  closeDialog: () => set({ dialog: null }),

  setZoom: (zoom: number) => set({ zoom }),
  
  setTheme: (themeId: string) => {
    const theme = THEME_PRESETS.find(t => t.id === themeId) || THEME_PRESETS[0];
    set({ theme });
    
    // 动态应用 CSS 变量到 Root
    const root = document.documentElement;
    root.style.setProperty('--color-brand-indigo', theme.primary);
    root.style.setProperty('--color-brand-purple', theme.secondary);
    root.style.setProperty('--brand-gradient', theme.gradient);
    root.style.setProperty('--brand-shadow', theme.shadow);
    root.style.setProperty('--brand-glow', theme.shadow.replace('0.2', '0.4'));
    root.style.setProperty('--color-accent-indigo', theme.primary);
    root.style.setProperty('--color-accent-blue', theme.secondary);
  },

  
  setAppearanceMode: (mode: 'light' | 'dark' | 'system' | 'eye-protection') => {
    set({ appearanceMode: mode });
    get().applyAppearance(mode);
    get().saveSettings();
  },

  setStartupBehavior: (behavior: 'restore' | 'blank') => {
    set({ startupBehavior: behavior });
    get().saveSettings();
  },

  setAutoSave: (autoSave: boolean) => {
    set({ autoSave });
    get().saveSettings();
  },

  applyAppearance: (mode: 'light' | 'dark' | 'system' | 'eye-protection') => {
    if (mode === 'eye-protection') {
      document.documentElement.setAttribute('data-theme', 'eye-protection');
      return;
    }
    const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  },

  loadSession: async () => {
    try {
      const sessionStr = localStorage.getItem('iml_session');
      let restoredWorkspace = false;
      
      if (sessionStr) {
        const session = JSON.parse(sessionStr);

        // 上次打开的文件夹和它的展开状态；文件夹已经不在了就算了，不报错
        if (typeof session.folderPath === 'string' && session.folderPath && await window.api.fs.exists(session.folderPath)) {
          if (Array.isArray(session.expandedPaths)) set({ expandedPaths: session.expandedPaths });
          await get().loadFolder(session.folderPath);
          restoredWorkspace = true;
        }
        if (typeof session.sidebarVisible === 'boolean') set({ sidebarVisible: session.sidebarVisible });
        if (session.sidebarTab === 'files' || session.sidebarTab === 'outline') set({ sidebarTab: session.sidebarTab });

        // 恢复 Recent Files
        if (session.recentFiles) {
          set({ recentFiles: session.recentFiles });
        }
        if (typeof session.sidebarWidth === 'number') {
          get().setSidebarWidth(session.sidebarWidth);
        }

        // 恢复 Tabs：与启动时通过「打开方式」已打开的标签页合并，而非覆盖
        const tabsToRestore: any[] = session.tabs || [];
        const preOpened = get().tabs;
        const restoredTabs: Tab[] = tabsToRestore
          .filter((t) => t && typeof t.id === 'string' && !preOpened.some((p) => p.id === t.id))
          .map((t) => ({
            id: t.id,
            title: t.title || t.id.split(/[/\\]/).pop() || '未命名',
            mode: t.mode || 'word',
            isDirty: !!t.isDirty,
            content: typeof t.content === 'string' ? t.content : '',
          }));
        if (restoredTabs.length > 0) {
          // 并行读盘、一次性写回：避免逐个 set 让整棵组件树反复渲染
          const loaded = await Promise.all(restoredTabs.map(async (tab): Promise<Tab | null> => {
            if (tab.id.startsWith('new-')) return tab; // 未命名文档：内容已随会话保存
            try {
              const result = await window.api.fs.readFile(tab.id);
              if (!result.success || result.content === undefined) return null;
              const diskContent = result.content || '';
              // 上次退出前未保存的修改优先于磁盘内容，避免重启丢稿
              const useDirty = tab.isDirty && tab.content.length > 0 && tab.content !== diskContent;
              return { ...tab, content: useDirty ? tab.content : diskContent, isDirty: useDirty };
            } catch (e) {
              return null;
            }
          }));
          const survivors = loaded.filter((t): t is Tab => t !== null);
          // 读盘期间可能已通过「打开方式」新开了标签，以当前 store 为准合并
          const preOpenedNow = get().tabs;
          set({
            tabs: [...survivors.filter(s => !preOpenedNow.some(p => p.id === s.id)), ...preOpenedNow],
            activeTabId: preOpenedNow.length > 0 ? get().activeTabId : session.activeTabId,
          });

          const currentTabs = get().tabs;
          if (currentTabs.length > 0 && !currentTabs.find(t => t.id === get().activeTabId)) {
            set({ activeTabId: currentTabs[currentTabs.length - 1].id });
          } else if (currentTabs.length === 0) {
            set({ activeTabId: null });
          }
        }
      }
      return restoredWorkspace;
    } catch (e) {
      console.error('Failed to load session:', e);
      return false;
    }
  },

  loadSettings: async () => {
    try {
      const settings = await window.api.app.getSettings();
      if (settings) {
        set({
          appearanceMode: settings.appearanceMode || 'light',
          startupBehavior: settings.startupBehavior === 'restore' ? 'restore' : 'blank',
          autoSave: !!settings.autoSave,
          imageCompression: settings.imageCompression ?? true,
          fetchLinkTitle: settings.fetchLinkTitle ?? true,
          spellcheck: !!settings.spellcheck,
          editorPrefs: normalizeEditorPrefs(settings.editorPrefs),
        });
        applyEditorPrefs(get().editorPrefs);
        if (settings.themeId) get().setTheme(settings.themeId);
        get().applyAppearance(settings.appearanceMode || 'light');
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  },

  saveSettings: async () => {
    const { appearanceMode, startupBehavior, autoSave, theme, imageCompression, fetchLinkTitle, spellcheck, editorPrefs } = get();
    await window.api.app.saveSettings({
      appearanceMode, startupBehavior, autoSave,
      imageCompression, fetchLinkTitle, spellcheck, editorPrefs,
      themeId: theme?.id,
    });
  },

  setSelectedNodePath: (path) => set({ selectedNodePath: path }),
  setRenamingPath: (path) => set({ renamingPath: path }),
  setContextMenu: (cm) => set((state) => ({ contextMenu: { ...state.contextMenu, ...cm } })),

  renameFile: async (oldPath: string, newName: string) => {
    try {
      const sep = pathSep(oldPath);
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf(sep));
      const newPath = `${parentDir}${sep}${newName}`;
      
      const result = await window.api.fs.rename(oldPath, newPath);
      if (result.success) {
        // 文件本身或（重命名目录时）其下所有路径都要改
        const remap = (p: string) => p === oldPath ? newPath : p.startsWith(oldPath + sep) ? newPath + p.slice(oldPath.length) : p;
        set((state) => ({
          tabs: state.tabs.map(t => {
            const id = remap(t.id);
            if (id === t.id) return t;
            return { ...t, id, title: id.split(sep).pop()?.replace(/\.md$/i, '') || t.title };
          }),
          activeTabId: state.activeTabId ? remap(state.activeTabId) : state.activeTabId,
          renamingPath: null,
          selectedNodePath: state.selectedNodePath ? remap(state.selectedNodePath) : state.selectedNodePath,
          expandedPaths: state.expandedPaths.map(remap),
        }));
        await get().refreshWorkspace();
        return true;
      }
      return false;
    } catch (e) {
      console.error('Rename failed:', e);
      return false;
    }
  },

  deleteFile: async (path: string) => {
    try {
      const result = await window.api.fs.delete(path);
      if (result.success) {
        // 删除目录时连同其下已打开的标签页一起关闭
        const sep = pathSep(path);
        get().tabs.filter(t => t.id === path || t.id.startsWith(path + sep)).forEach(t => get().closeTab(t.id));
        set((state) => ({ selectedNodePath: state.selectedNodePath === path ? null : state.selectedNodePath }));
        await get().refreshWorkspace();
        return true;
      }
      return false;
    } catch (e) {
      console.error('Delete failed:', e);
      return false;
    }
  },

  duplicateFile: async (oldPath: string) => {
    try {
      const extMatch = oldPath.match(/\.([^.]+)$/);
      const ext = extMatch ? `.${extMatch[1]}` : '';
      const basePath = extMatch ? oldPath.substring(0, oldPath.length - ext.length) : oldPath;
      
      let result = await window.api.fs.copy(oldPath, `${basePath} 副本${ext}`);
      for (let counter = 2; !result.success && counter <= 50; counter++) {
        result = await window.api.fs.copy(oldPath, `${basePath} 副本 ${counter}${ext}`);
      }
      if (!result.success) return false;
      await get().refreshWorkspace();
      return true;
    } catch (e) {
      console.error('Duplicate failed:', e);
      return false;
    }
  },

  checkUpdates: async () => {
    set({ updateStatus: { show: true, loading: true, latestVersion: null, error: null } });
    
    try {
      const result = await window.api.app.checkUpdates();
      if (!result.success) {
        throw new Error(result.error);
      }
      
      set({
        updateStatus: {
          show: true,
          loading: false,
          latestVersion: result.latestVersion || null,
          error: null,
          release: { notes: result.notes, releaseUrl: result.releaseUrl, download: result.download },
        }
      });
      // 用户自己点开看过了，自动检查就不用再为这个版本弹一次
      if (result.latestVersion) markUpdateAnnounced(result.latestVersion);
    } catch (err: any) {
      set({
        updateStatus: {
          show: true,
          loading: false,
          latestVersion: null,
          error: err.message || '检查更新失败'
        }
      });
    }
  },

  autoCheckUpdates: async () => {
    // 静默检查：没有新版本、或者检查失败，都不打扰
    try {
      const result = await window.api.app.checkUpdates();
      if (!result.success || !result.latestVersion || !isNewerVersion(result.latestVersion, window.api.appVersion)) return;
      // 同一个版本只主动弹一次；之后靠「帮助」菜单上的小红点提醒，不再每次启动都打断
      const firstTime = !wasUpdateAnnounced(result.latestVersion);
      if (firstTime) markUpdateAnnounced(result.latestVersion);
      set((state) => ({
        updateStatus: {
          show: firstTime || state.updateStatus.show,
          loading: false,
          latestVersion: result.latestVersion!,
          error: null,
          release: { notes: result.notes, releaseUrl: result.releaseUrl, download: result.download },
        }
      }));
    } catch (err) {
      console.error('Auto update check failed:', err);
    }
  }
}));

// 已经主动提醒过的版本：同一个版本只弹一次
const UPDATE_ANNOUNCED_KEY = 'iml.update.announced';
function wasUpdateAnnounced(version: string): boolean { try { return localStorage.getItem(UPDATE_ANNOUNCED_KEY) === version; } catch { return false; } }
function markUpdateAnnounced(version: string) { try { localStorage.setItem(UPDATE_ANNOUNCED_KEY, version); } catch { /* 存不了就下次再弹 */ } }

// ── 会话持久化（防抖写入 localStorage）──
// 未保存的修改（脏标签页 / 新建未命名文档）连同内容一起保存，重启后可恢复；超大内容跳过以免撑爆 localStorage
const MAX_PERSISTED_CONTENT = 1_500_000;
// 只有主窗口持有真实会话；?window=xxx 的独立页面（截图用）store 是空的，绝不能让它们写回 localStorage
const isMainWindow = !new URLSearchParams(window.location.search).get('window');
let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let sessionPersistDisabled = false;

function persistSession(state: AppState) {
  if (!isMainWindow || sessionPersistDisabled) return;
  const sessionToSave = {
    folderPath: state.workspacePath,
    expandedPaths: state.expandedPaths,
    activeTabId: state.activeTabId,
    recentFiles: state.recentFiles,
    sidebarWidth: state.sidebarWidth,
    sidebarVisible: state.sidebarVisible,
    sidebarTab: state.sidebarTab,
    tabs: state.tabs.map(t => {
      const keepContent = (t.isDirty || t.id.startsWith('new-')) && t.content.length <= MAX_PERSISTED_CONTENT;
      return { id: t.id, title: t.title, isDirty: t.isDirty, mode: t.mode, ...(keepContent ? { content: t.content } : {}) };
    }),
  };
  try {
    localStorage.setItem('iml_session', JSON.stringify(sessionToSave));
  } catch (e) {
    console.warn('Session persist failed:', e);
  }
}

/** 立即落盘：先让编辑器把未写回的内容刷进 store，再写 localStorage（关窗 / 失焦时调用） */
export function flushSessionNow() {
  if (!isMainWindow || sessionPersistDisabled) return;
  useAppStore.getState().editorFlush?.();
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
  }
  persistSession(useAppStore.getState());
}

/** 清空会话并重载：期间禁止回写，否则 reload 前的 beforeunload 会把旧会话原样写回去 */
export function clearSessionAndReload() {
  sessionPersistDisabled = true;
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  localStorage.removeItem('iml_session');
  window.location.reload();
}

useAppStore.subscribe((state, prevState) => {
  const shouldSave =
    state.tabs !== prevState.tabs ||
    state.activeTabId !== prevState.activeTabId ||
    state.workspacePath !== prevState.workspacePath ||
    state.expandedPaths !== prevState.expandedPaths ||
    state.recentFiles !== prevState.recentFiles ||
    state.sidebarWidth !== prevState.sidebarWidth ||
    state.sidebarVisible !== prevState.sidebarVisible ||
    state.sidebarTab !== prevState.sidebarTab;
  if (!shouldSave || !isMainWindow || sessionPersistDisabled) return;
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  // 脏标签页的内容也会序列化，1s 防抖把连续打字合并成一次写入
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    persistSession(useAppStore.getState());
  }, 1000);
});

if (isMainWindow) {
  window.addEventListener('beforeunload', flushSessionNow);
  window.addEventListener('blur', flushSessionNow);
}

// 开发模式下把 store 挂到 window 上：端到端测试要核对「标签页里的内容和磁盘是不是一致」这类界面上看不出来的状态。
// 生产包里 import.meta.env.DEV 是 false，这一段会被整个去掉
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __imlStore?: typeof useAppStore }).__imlStore = useAppStore;
