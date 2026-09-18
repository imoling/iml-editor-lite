import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  FileCode, X, FileDown, Plus, Save, FileUp, Sidebar as SidebarIcon, Layout, RotateCw, Minus, Square, Settings, Image, CalendarDays, Sparkles, History, Focus, ImageOff, Network, Wand2,
} from 'lucide-react';
import { exportActiveTabToPdf, exportActiveTabToHtml } from '../../utils/exportPdf';
import { isNewerVersion } from '../../utils/version';

type MenuId = 'file' | 'edit' | 'view' | 'intel' | 'help';

const MenuItem: React.FC<{
  icon?: React.ReactNode;
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  dim?: boolean;
  onClick: () => void;
}> = ({ icon, label, hint, disabled, dim, onClick }) => (
  <div className={`menu-item ${disabled ? 'menu-item--disabled' : ''} ${dim ? 'menu-item--dim' : ''}`} onClick={onClick}>
    {icon} {label}
    {hint && <span className="menu-hint">{hint}</span>}
  </div>
);

const MenuDivider = () => <div className="menu-divider" />;

export const TitleBar: React.FC = () => {
  const {
    tabs, activeTabId, setActiveTab, closeTab,
    toggleSidebar, toggleToolbar, toggleStatusBar, createNewFile,
    sidebarVisible, toolbarVisible, statusBarVisible,
    openFile, saveActiveFile, refreshWorkspace, setTabToClose, updateStatus, checkUpdates, openDailyNote, openDialog,
    focusMode, toggleFocusMode, aiEnabled,
  } = useAppStore();

  const hasUpdate = isNewerVersion(updateStatus.latestVersion, window.api.appVersion);
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);
  const activeTab = tabs.find(t => t.id === activeTabId);
  const tabsRef = useRef<HTMLDivElement>(null);
  const isMac = window.api.app.platform === 'darwin';

  const handleCloseTab = (id: string) => {
    const tab = tabs.find(t => t.id === id);
    const isTemp = id.startsWith('new-');
    const hasContent = !!tab?.content.trim();
    // 空白的未命名文档直接关，有内容的未命名 / 已修改文档才询问是否保存
    if (tab && ((isTemp && hasContent) || (!isTemp && tab.isDirty))) {
      setTabToClose(id);
    } else {
      closeTab(id);
    }
  };

  // 自动滚动激活标签到可见区域
  useEffect(() => {
    if (activeTabId && tabsRef.current) {
      tabsRef.current.querySelector('.titlebar-tab.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTabId]);

  /** 执行菜单动作并收起菜单 */
  const run = (fn: () => void) => () => { setActiveMenu(null); fn(); };

  const Menu: React.FC<{ id: MenuId; label: string; width?: number; badge?: boolean; children: React.ReactNode }> = ({ id, label, width, badge, children }) => (
    <div className="menu-anchor">
      <button className="menu-trigger" onClick={() => setActiveMenu(activeMenu === id ? null : id)}>
        {label}
        {badge && <div className="notification-dot" />}
      </button>
      {activeMenu === id && (
        <>
          <div className="menu-backdrop" onClick={() => setActiveMenu(null)} />
          <div className="dropdown-menu" style={width ? { minWidth: width } : undefined}>{children}</div>
        </>
      )}
    </div>
  );

  return (
    <header className="titlebar">
      {isMac && <div className="titlebar-traffic-lights" />}

      <div className={`titlebar-menus ${isMac ? '' : 'titlebar-menus--win'}`}>
        <Menu id="file" label="文件" width={220}>
          <MenuItem icon={<Plus size={14} />} label="新建文档" hint="⌘N" onClick={run(createNewFile)} />
          <MenuItem icon={<FileUp size={14} />} label="打开..." hint="⌘O" onClick={run(openFile)} />
          <MenuItem icon={<CalendarDays size={14} />} label="今日日记" hint="⇧⌘D" onClick={run(openDailyNote)} />
          <MenuDivider />
          <MenuItem icon={<Save size={14} />} label="保存" hint="⌘S" disabled={!activeTab} onClick={run(() => saveActiveFile())} />
          <MenuItem icon={<Save size={14} />} label="另存为..." hint="⇧⌘S" disabled={!activeTab} onClick={run(() => saveActiveFile(true))} />
          <MenuDivider />
          <MenuItem icon={<History size={14} />} label="版本历史…" hint="⇧⌘H" disabled={!activeTab} onClick={run(() => openDialog('history'))} />
          <MenuDivider />
          <MenuItem icon={<FileDown size={14} />} label="导出为 PDF" hint="⌘P" disabled={!activeTab} onClick={run(exportActiveTabToPdf)} />
          <MenuItem icon={<FileDown size={14} />} label="导出为 HTML" disabled={!activeTab} onClick={run(exportActiveTabToHtml)} />
        </Menu>

        <Menu id="edit" label="编辑">
          <MenuItem label="撤销" hint="⌘Z" onClick={run(() => document.execCommand('undo'))} />
          <MenuItem label="重做" hint="⇧⌘Z" onClick={run(() => document.execCommand('redo'))} />
          <MenuDivider />
          <MenuItem label="剪切" hint="⌘X" onClick={run(() => document.execCommand('cut'))} />
          <MenuItem label="复制" hint="⌘C" onClick={run(() => document.execCommand('copy'))} />
          <MenuItem label="粘贴" hint="⌘V" onClick={run(() => document.execCommand('paste'))} />
          <MenuItem label="全选" hint="⌘A" onClick={run(() => document.execCommand('selectAll'))} />
        </Menu>

        <Menu id="view" label="视图" width={180}>
          <MenuItem icon={<SidebarIcon size={14} />} label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'} hint="⌘\" onClick={run(toggleSidebar)} />
          <MenuItem icon={<Focus size={14} />} label={focusMode ? '退出专注模式' : '专注模式'} hint="⇧⌘." onClick={run(toggleFocusMode)} />
          <MenuDivider />
          <MenuItem icon={<Layout size={14} />} label={toolbarVisible ? '隐藏工具栏' : '显示工具栏'} dim={!toolbarVisible} onClick={run(toggleToolbar)} />
          <MenuItem icon={<Layout size={14} />} label={statusBarVisible ? '隐藏状态栏' : '显示状态栏'} dim={!statusBarVisible} onClick={run(toggleStatusBar)} />
          <MenuDivider />
          <MenuItem icon={<RotateCw size={14} />} label="刷新笔记库" onClick={run(refreshWorkspace)} />
          <MenuItem icon={<ImageOff size={14} />} label="清理未引用的图片…" onClick={run(() => openDialog('image-cleanup'))} />
        </Menu>

        {/* 按功能命名：每一项打开对应功能的设置（用哪个模型 / 服务） */}
        <Menu id="intel" label="智能">
          <MenuItem icon={<Wand2 size={14} />} label="写作助手…" hint="⇧⌘M" onClick={run(() => openDialog('ai-config'))} />
          <MenuItem icon={<Network size={14} />} label="相关笔记…" disabled={!aiEnabled} onClick={run(() => openDialog('semantic-config'))} />
          <MenuDivider />
          <MenuItem icon={<Image size={14} />} label="AI 配图…" onClick={run(() => openDialog('image-config'))} />
        </Menu>

        <Menu id="help" label="帮助" width={180} badge={hasUpdate}>
          <MenuItem icon={<Layout size={14} />} label="快捷键" hint="⌘/" onClick={run(() => openDialog('shortcuts'))} />
          <MenuItem icon={<RotateCw size={14} />} label={<>检查更新{hasUpdate && <div className="notification-dot" />}</>} onClick={run(checkUpdates)} />
          <MenuItem icon={<Settings size={14} />} label="设置" onClick={run(() => openDialog('settings'))} />
          <MenuItem icon={<Sparkles size={14} />} label="新特性介绍" onClick={run(() => openDialog('whats-new'))} />
          <MenuDivider />
          <MenuItem icon={<Layout size={14} />} label="关于" onClick={run(() => openDialog('about'))} />
        </Menu>
      </div>

      {/* 标签页区域 */}
      <div ref={tabsRef} className="titlebar-tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div key={tab.id} className={`titlebar-tab ${isActive ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
              <FileCode size={14} color={isActive ? 'var(--color-accent-indigo)' : 'var(--text-muted)'} />
              {tab.externallyModified && (
                <span className="dot-indicator dot-indicator--warn" title="这个文件在磁盘上已被外部修改或删除；保存会覆盖磁盘版本" />
              )}
              <span className="tab-title" title={tab.externallyModified ? '磁盘上已被外部修改' : tab.id}>{tab.title}</span>
              <div className="close-tab-icon" onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}>
                <X size={12} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Windows 窗口控制按钮 */}
      {!isMac && (
        <div className="window-controls">
          <button className="window-control-btn minimize" onClick={() => window.api.app.minimize()} title="最小化"><Minus size={14} /></button>
          <button className="window-control-btn maximize" onClick={() => window.api.app.maximize()} title="最大化/还原"><Square size={12} /></button>
          <button className="window-control-btn close" onClick={() => window.api.app.close()} title="关闭"><X size={14} /></button>
        </div>
      )}
    </header>
  );
};
