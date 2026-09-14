import React, { useEffect } from 'react';
import { TitleBar } from './components/TitleBar/TitleBar';
import { Sidebar, ActivityBar } from './components/Sidebar/Sidebar';
import { EditorArea } from './components/Editor/EditorArea';
import { StatusBar } from './components/StatusBar/StatusBar';
import { useAppStore, THEME_PRESETS, clearSessionAndReload, type DialogId } from './stores/appStore';
import AboutModal from './components/About/AboutModal';
import ShortcutsModal from './components/Help/ShortcutsModal';
import ModelConfigModal from './components/AI/ModelConfigModal';
import { ImageConfigModal } from './components/AI/ImageConfigModal';
import { SettingsModal } from './components/Settings/SettingsModal';
import { WhatsNewModal } from './components/WhatsNew/WhatsNewModal';
import { latestWhatsNew, shouldShowWhatsNew } from './data/whatsNew';
import { extractHeadings } from './utils/outline';
import { ConfirmDialog } from './components/ConfirmDialog';
import { exportActiveTabToPdf } from './utils/exportPdf';
import { formatVersion, isNewerVersion } from './utils/version';
import './styles/layout.css';

/** 拉取主进程排队的「打开方式」/ 命令行文件并逐个打开（启动完成后与收到提醒时都会调用） */
async function drainPendingOpenFiles() {
  try {
    const files = await window.api.app.consumePendingOpenFiles();
    for (const filePath of files) {
      await useAppStore.getState().openFileByPath(filePath);
    }
  } catch (e) {
    console.error('Failed to open pending files:', e);
  }
}

const App: React.FC = () => {
  const { 
    toggleMode, 
    activeTabId, 
    tabs,
    sidebarVisible,
    statusBarVisible,
    setOutline,
    toggleSidebar,
    toggleToolbar,
    toggleStatusBar,
    createNewFile,
    toggleFind,
    toggleReplace,
    openFile,
    openFileByPath,
    openDirectory,
    saveActiveFile,
    tabToClose,
    setTabToClose,
    closeTab,
    setActiveTab,
    autoCheckUpdates,
    theme,
    setTheme,
    loadSession,
    loadSettings,
    appearanceMode,
    applyAppearance,
    dialog,
    openDialog,
    closeDialog,
  } = useAppStore();

  const activeTab = tabs.find(t => t.id === activeTabId);
  const whatsNewEntry = latestWhatsNew(window.api.appVersion);

  // 主窗口标题带上当前文档名，Dock / 调度中心里一眼能分清
  useEffect(() => {
    document.title = activeTab ? `${activeTab.title} — iML Markdown Editor` : 'iML Markdown Editor';
  }, [activeTab?.title]);

  // Update outline when active tab content changes
  useEffect(() => {
    if (activeTab) {
      const headings = extractHeadings(activeTab.content);
      setOutline(headings);
    } else {
      setOutline([]);
    }
  }, [activeTab?.content, setOutline]);

  const handleConfirmSave = async () => {
    if (!tabToClose) return;
    const currentActiveId = activeTabId;
    
    // If it's not the active tab, we need to switch to it to save
    if (currentActiveId !== tabToClose) {
      setActiveTab(tabToClose);
    }
    
    const saved = await saveActiveFile();
    if (saved) {
      closeTab(tabToClose);
      setTabToClose(null);
    }
  };

  useEffect(() => {
    const isMac = window.api.app.platform === 'darwin';
    const handleKeyDown = async (e: KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      
      // Cmd+E to toggle mode
      if (modKey && e.key === 'e') {
        e.preventDefault();
        toggleMode();
      }

      // Cmd+\ to toggle sidebar
      if (modKey && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
      }

      // Cmd+N to create new file
      if (modKey && e.key === 'n') {
        e.preventDefault();
        createNewFile();
      }

      // Alt+Cmd+F：查找并替换（⌘H 在 macOS 上被系统「隐藏应用」占用，不能用）
      // 注意 macOS 下按住 ⌥ 时 e.key 会变成特殊字符，必须用 e.code 判断
      if (modKey && e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        toggleReplace();
        return;
      }

      // Cmd+Shift+F：全文搜索
      if (modKey && e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        useAppStore.getState().openGlobalSearch();
        return;
      }

      // Cmd+F：查找
      if (modKey && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        toggleFind();
        return;
      }

      // Cmd+Shift+D：今日日记
      if (modKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        useAppStore.getState().openDailyNote();
        return;
      }

      // Cmd+P：导出 PDF
      if (modKey && !e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        exportActiveTabToPdf();
        return;
      }
      
      // Cmd+Shift+O to open directory
      if (modKey && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openDirectory();
        return;
      }
      
      // Cmd+O to open file (or Ctrl+O on Mac if user specifically expects it)
      if ((modKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFile();
      }

      // Cmd+, to open settings
      if (modKey && e.key === ',') {
        e.preventDefault();
        openDialog('settings');
      }

      // Cmd+/ to open shortcuts
      if (modKey && e.key === '/') {
        e.preventDefault();
        openDialog('shortcuts');
      }

      // Cmd+Shift+M：模型配置
      if (modKey && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        openDialog('ai-config');
      }
      
      // Cmd+S or Cmd+Shift+S to save file
      if (modKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveFile(e.shiftKey);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMode, openFile, openDirectory, saveActiveFile, toggleSidebar, toggleToolbar, toggleStatusBar, createNewFile, toggleFind, toggleReplace, openDialog]);

  // 弹窗打开时按 Esc 关闭
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDialog(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, closeDialog]);

  // 监听主进程发来的 open-file（macOS 双击或"打开方式"）
  useEffect(() => {
    window.api.events.on('open-file', () => drainPendingOpenFiles());
    window.api.events.on('session:clear', () => clearSessionAndReload());
    // 笔记库目录被外部（同步盘 / 其他编辑器）改动：刷新树，未修改的标签页跟随磁盘
    window.api.events.on('library:changed', (paths: string[]) => useAppStore.getState().handleExternalChanges(paths));
    window.api.events.on('menu:new-file', () => createNewFile());
    window.api.events.on('menu:open-file', () => openFile());
    window.api.events.on('menu:save', () => saveActiveFile());
    // 原生菜单 / 其他入口要求打开某个弹窗
    window.api.events.on('dialog:open', (id: DialogId) => openDialog(id));
  }, [openFileByPath, createNewFile, openFile, saveActiveFile, openDialog]);

  // Handle auto-update check on mount
  useEffect(() => {
    // Only auto-check after a short delay to not block initial rendering and show it as a premium background task
    const timer = setTimeout(() => {
      autoCheckUpdates();
    }, 3000);
    return () => clearTimeout(timer);
  }, [autoCheckUpdates]);

  // Apply theme on mount and load session & settings
  useEffect(() => {
    setTheme(theme.id);
    const init = async () => {
      try {
        await loadSettings();
        if (useAppStore.getState().startupBehavior === 'restore') {
          await loadSession();
        }
      } catch (e) {
        console.error('Init failed:', e);
      }
      // 无论会话恢复是否成功，启动时传入的文件都要打开
      await drainPendingOpenFiles();
      // 新安装或升级后展示一次新特性介绍
      try {
        const state = await window.api.app.getWhatsNewState();
        if (shouldShowWhatsNew(state.current, state.lastSeen)) {
          await window.api.app.markWhatsNewSeen();
          setTimeout(() => useAppStore.getState().openDialog('whats-new'), 600);
        }
      } catch (e) {
        console.warn('[whats-new] check failed', e);
      }
    };
    init();

    // 监听设置窗口保存后的广播，重新加载设置到主窗口
    window.api.events.on('settings:changed', () => {
      useAppStore.getState().loadSettings();
    });

    // 实时预览：设置窗口每次改动都推送到主窗口
    window.api.events.on('settings:preview', (settings: any) => {
      const store = useAppStore.getState();
      if (settings.appearanceMode) store.applyAppearance(settings.appearanceMode);
      if (settings.themeId) {
        // 直接应用 CSS 变量，不触发保存
        const theme = THEME_PRESETS.find((t: any) => t.id === settings.themeId);
        if (theme) {
          const root = document.documentElement;
          root.style.setProperty('--color-brand-indigo', theme.primary);
          root.style.setProperty('--color-brand-purple', theme.secondary);
          root.style.setProperty('--brand-gradient', theme.gradient);
          root.style.setProperty('--brand-shadow', theme.shadow);
          root.style.setProperty('--brand-glow', theme.shadow.replace('0.2', '0.4'));
          root.style.setProperty('--color-accent-indigo', theme.primary);
          root.style.setProperty('--color-accent-blue', theme.secondary);
        }
      }
    });

    // 取消：从磁盘重载，恢复原始设置
    window.api.events.on('settings:revert', () => {
      useAppStore.getState().loadSettings();
    });
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (appearanceMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyAppearance('system');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [appearanceMode, applyAppearance]);

  return (
    <div className="app-layout" id="app">
      <TitleBar />
      
      <div className="main-content">
        <ActivityBar />
        {sidebarVisible && <Sidebar />}
        <EditorArea />
      </div>
      
      {statusBarVisible && <StatusBar />}

      {tabToClose && (
        <ConfirmDialog
          title="保存更改？"
          message={`文件 "${tabs.find(t => t.id === tabToClose)?.title}" 已修改，是否在关闭前保存？`}
          onConfirm={handleConfirmSave}
          onDiscard={() => {
            closeTab(tabToClose);
            setTabToClose(null);
          }}
          onCancel={() => setTabToClose(null)}
        />
      )}

      {/* 检查更新状态弹窗 */}
      {useAppStore.getState().updateStatus.show && (
        <UpdateModal />
      )}

      {/* 配置 / 关于 / 快捷键：主窗口内的浮层，不新开窗口 */}
      {dialog === 'about' && <AboutModal isOpen onClose={closeDialog} />}
      {dialog === 'shortcuts' && <ShortcutsModal isOpen onClose={closeDialog} />}
      {dialog === 'ai-config' && <ModelConfigModal isOpen onClose={closeDialog} />}
      {dialog === 'image-config' && <ImageConfigModal onClose={closeDialog} />}
      {dialog === 'settings' && <SettingsModal onClose={closeDialog} />}
      {dialog === 'whats-new' && whatsNewEntry && <WhatsNewModal entry={whatsNewEntry} onClose={closeDialog} />}

    </div>
  );
};

// 提取 UpdateModal 组件以保持 App 组件整洁
import { RotateCw, X, Layout } from 'lucide-react';

const UpdateModal: React.FC = () => {
  const { updateStatus, setUpdateStatus } = useAppStore();
  const close = () => setUpdateStatus({ ...updateStatus, show: false });
  const current = window.api.appVersion;
  const hasUpdate = isNewerVersion(updateStatus.latestVersion, current);

  return (
    <div className="modal-backdrop modal-backdrop--top">
      <div className="modal-card modal-card--compact">
        {updateStatus.loading ? (
          <>
            <RotateCw size={32} className="animate-spin" color="var(--color-accent-indigo)" />
            <p className="update-modal__text">正在检查更新...</p>
          </>
        ) : updateStatus.error ? (
          <>
            <X size={32} color="var(--color-accent-coral)" />
            <p className="update-modal__text">{updateStatus.error}</p>
            <button onClick={close} className="btn btn-surface btn-sm mt-8">关闭</button>
          </>
        ) : (
          <>
            <Layout size={32} color={hasUpdate ? 'var(--color-accent-indigo)' : 'var(--text-muted)'} />
            <div className="text-center">
              <p className="update-modal__title">{hasUpdate ? '发现新版本！' : '已是最新版本'}</p>
              <p className="update-modal__sub">
                {hasUpdate
                  ? `最新版本: ${formatVersion(updateStatus.latestVersion)} (当前: ${formatVersion(current)})`
                  : `当前版本 ${formatVersion(current)} 已是最新`}
              </p>
            </div>
            <div className="row gap-12 mt-8 btn-block">
              <button onClick={close} className="btn btn-surface btn-sm btn-block">关闭</button>
              {hasUpdate && (
                <button
                  onClick={() => { close(); window.api.shell.openExternal('https://github.com/imoling/iml-markdown-editor/releases'); }}
                  className="btn btn-primary btn-sm btn-block"
                >
                  前往下载
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default App;
