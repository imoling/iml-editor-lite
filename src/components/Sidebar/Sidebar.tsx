import React from 'react';
import { useAppStore, FileNode, HeadingNode, readLibraryDir } from '../../stores/appStore';
import { SearchPanel } from './SearchPanel';
import { TagsPanel } from './TagsPanel';
import { RelatedPanel } from './RelatedPanel';
import {
  ChevronDown, ChevronRight, FolderOpen, FileText, FileCode, FolderClosed,
  List, RotateCw, Star, BookOpen, Settings, FilePlus, FolderPlus, CalendarDays, LayoutTemplate, FolderOpen as FolderOpenIcon, Search, Hash,
} from 'lucide-react';

const isMac = window.api.app.platform === 'darwin';
const REVEAL_LABEL = isMac ? '在访达中显示' : '在资源管理器中显示';
const MD_RE = /\.(md|markdown|mdown|mkd)$/i;

export const ActivityBar: React.FC = () => {
  const { sidebarTab, setSidebarTab, sidebarVisible } = useAppStore();
  const tabs = [
    { id: 'library' as const, icon: <BookOpen size={16} />, label: '笔记库', title: '笔记库（所有笔记与文件夹）' },
    { id: 'catalog' as const, icon: <List size={16} />, label: '目录', title: '当前文档目录、反向链接与相关笔记' },
    { id: 'tags' as const, icon: <Hash size={16} />, label: '标签', title: '所有标签' },
    { id: 'search' as const, icon: <Search size={16} />, label: '搜索', title: '搜索所有笔记 (⇧⌘F)' },
  ];
  return (
    <div className="activity-bar">
      {tabs.map((t) => (
        <button key={t.id} className={`activity-bar-btn ${sidebarTab === t.id && sidebarVisible ? 'active' : ''}`} onClick={() => setSidebarTab(t.id)} title={t.title}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
};

/** 打开（或激活）一个笔记标签页 */
async function openNote(path: string, title: string) {
  const { tabs, setActiveTab, openTab } = useAppStore.getState();
  if (tabs.some((t) => t.id === path)) {
    setActiveTab(path);
    return;
  }
  const result = await window.api.fs.readFile(path);
  if (result.success && result.content !== undefined) {
    openTab({ id: path, title, content: result.content, isDirty: false, mode: 'word' });
  } else {
    useAppStore.getState().notify(`打不开「${title}」：文件可能已被移动或删除，刷新一下笔记库试试`, 8000);
  }
}

const FileTreeItem: React.FC<{ node: FileNode; level: number }> = ({ node, level }) => {
  const { updateFileNode, activeTabId, expandedPaths, setExpanded, starredFiles, toggleStar, selectedNodePath, setSelectedNodePath, renamingPath, setRenamingPath, renameFile, setContextMenu } = useAppStore();
  const isOpen = expandedPaths.includes(node.path);
  const [editName, setEditName] = React.useState(node.name.replace(/\.md$/i, ''));
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (renamingPath === node.path) {
      setEditName(node.name.replace(/\.md$/i, ''));
      requestAnimationFrame(() => renameInputRef.current?.select());
    }
  }, [renamingPath, node.name, node.path]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNodePath(node.path);
    if (node.isDirectory) {
      if (!isOpen && (!node.children || node.children.length === 0)) {
        const files = await readLibraryDir(node.path);
        if (files) updateFileNode(node.path, { children: files });
      }
      setExpanded(node.path, !isOpen);
    } else {
      await openNote(node.path, node.name);
    }
  };

  const isMarkdown = MD_RE.test(node.name);
  const isActive = activeTabId === node.path;
  const isSelected = selectedNodePath === node.path;
  const isRenaming = renamingPath === node.path;
  const isStarred = starredFiles.includes(node.path);

  const handleRenameSubmit = async () => {
    if (editName.trim() && editName !== node.name.replace(/\.md$/i, '')) {
      const newName = node.isDirectory || !isMarkdown ? editName.trim() : `${editName.trim()}.md`;
      await renameFile(node.path, newName);
    }
    setRenamingPath(null);
  };

  return (
    <div>
      <div
        className={`tree-item ${isActive && !node.isDirectory ? 'active' : ''} ${isSelected && !isActive ? 'tree-item--selected' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelectedNodePath(node.path);
          setContextMenu({ visible: true, x: e.clientX, y: e.clientY, node });
        }}
      >
        {node.isDirectory ? (
          <>
            {isOpen ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
            {isOpen ? <FolderOpen size={14} color="var(--color-brand-indigo)" /> : <FolderClosed size={14} color="var(--color-brand-indigo)" />}
          </>
        ) : (
          <>
            <span className="tree-item__spacer" />
            {isMarkdown ? <FileCode size={14} color={isActive ? 'var(--text-primary)' : 'var(--color-accent-green)'} /> : <FileText size={14} color="var(--text-secondary)" />}
          </>
        )}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              else if (e.key === 'Escape') setRenamingPath(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="tree-item__rename"
          />
        ) : (
          <span className={`tree-item__name ${isActive ? 'text-primary' : ''}`}>{node.isDirectory ? node.name : node.name.replace(/\.md$/i, '')}</span>
        )}
        {!node.isDirectory && !isRenaming && (
          <div className={`tree-item-star ${isStarred ? 'starred' : ''}`} onClick={(e) => { e.stopPropagation(); toggleStar(node.path); }} title={isStarred ? '取消收藏' : '加入收藏'}>
            <Star size={13} strokeWidth={isStarred ? 0 : 1.5} fill={isStarred ? 'currentColor' : 'none'} />
          </div>
        )}
      </div>

      {node.isDirectory && isOpen && node.children && (
        <div className="tree-children">
          {node.children.length === 0 ? (
            <div className="tree-empty" style={{ paddingLeft: `${(level + 1) * 12 + 22}px` }}>空文件夹</div>
          ) : (
            node.children.map((child) => <FileTreeItem key={child.path} node={child} level={level + 1} />)
          )}
        </div>
      )}
    </div>
  );
};

const StarredItem: React.FC<{ path: string }> = ({ path }) => {
  const { activeTabId, toggleStar } = useAppStore();
  const name = path.split(/[/\\]/).pop() || 'Unknown';
  const isActive = activeTabId === path;
  return (
    <div className={`tree-item tree-item--flat ${isActive ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); openNote(path, name); }} title={path}>
      <span className="tree-item__spacer" />
      <FileCode size={14} color={isActive ? 'var(--text-primary)' : 'var(--color-accent-green)'} />
      <span className={`tree-item__name ${isActive ? 'text-primary' : ''}`}>{name.replace(/\.md$/i, '')}</span>
      <div className="tree-item-star starred" onClick={(e) => { e.stopPropagation(); toggleStar(path); }} title="取消收藏">
        <Star size={13} strokeWidth={0} fill="currentColor" />
      </div>
    </div>
  );
};

const OutlineItem: React.FC<{ node: HeadingNode }> = ({ node }) => {
  const { scrollToHeading } = useAppStore();
  return (
    <div className="tree-item" style={{ paddingLeft: `${(node.level - 1) * 16 + 12}px` }} onClick={() => scrollToHeading(node)}>
      <span className={node.level === 1 ? 'outline-item--h1' : 'outline-item'}>{node.text}</span>
    </div>
  );
};

const MenuItem: React.FC<{ label: string; hint?: string; danger?: boolean; onClick: () => void }> = ({ label, hint, danger, onClick }) => (
  <div className={`context-menu__item ${danger ? 'context-menu__item--danger' : ''}`} onClick={onClick}>
    {label} {hint && <span className="context-menu__hint">{hint}</span>}
  </div>
);

const ContextMenuComponent = () => {
  const { contextMenu, setContextMenu, setRenamingPath, duplicateFile, deleteFile, createNoteIn, createFolderIn, workspacePath } = useAppStore();

  React.useEffect(() => {
    const close = () => setContextMenu({ visible: false });
    if (contextMenu.visible) document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu.visible, setContextMenu]);

  if (!contextMenu.visible || !contextMenu.node) return null;

  const node = contextMenu.node;
  const isRoot = node.path === workspacePath;
  const done = () => setContextMenu({ visible: false });

  return (
    <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {node.isDirectory && (
        <>
          <MenuItem label="新建笔记" onClick={() => { done(); createNoteIn(node.path); }} />
          <MenuItem label="新建文件夹" onClick={() => { done(); createFolderIn(node.path); }} />
          <div className="context-menu__divider" />
        </>
      )}
      {!isRoot && <MenuItem label="重命名" hint="F2" onClick={() => { done(); setRenamingPath(node.path); }} />}
      {!node.isDirectory && <MenuItem label="创建副本" hint={isMac ? '⌘D' : 'Ctrl+D'} onClick={() => { done(); duplicateFile(node.path); }} />}
      <MenuItem label={REVEAL_LABEL} onClick={() => { done(); window.api.shell.showItemInFolder(node.path); }} />
      {!isRoot && (
        <>
          <div className="context-menu__divider" />
          <MenuItem label="推入废纸篓" hint="⌫" danger onClick={() => { done(); deleteFile(node.path); }} />
        </>
      )}
    </div>
  );
};

/** 当前笔记的反向链接：哪些笔记里写了 [[本篇]] */
const BacklinksPanel: React.FC = () => {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const libraryVersion = useAppStore((s) => s.libraryVersion);
  const openFileByPath = useAppStore((s) => s.openFileByPath);
  const [links, setLinks] = React.useState<{ path: string; title: string; snippets: { before: string; match: string; after: string }[] }[]>([]);

  React.useEffect(() => {
    if (!activeTabId || activeTabId.startsWith('new-')) { setLinks([]); return; }
    const name = (activeTabId.split(/[/\\]/).pop() || '').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');
    let cancelled = false;
    window.api.search.backlinks(name).then((r) => { if (!cancelled) setLinks(r); }).catch(() => setLinks([]));
    return () => { cancelled = true; };
  }, [activeTabId, libraryVersion]);

  if (!activeTabId) return null;
  return (
    <div className="backlinks">
      <div className="sidebar-section-title">🔗 反向链接{links.length ? ` · ${links.length}` : ''}</div>
      {links.length === 0 ? (
        <div className="tree-empty tree-empty--root">还没有其他笔记链接到这里。在别的笔记里输入 [[ 即可引用。</div>
      ) : (
        links.map((l) => (
          <div key={l.path} className="search-result" onClick={() => openFileByPath(l.path)} title={l.path}>
            <div className="search-result__title"><span className="truncate flex-1">{l.title}</span></div>
            {l.snippets.slice(0, 2).map((s, i) => (
              <div key={i} className="search-result__snippet">{s.before}<mark>{s.match}</mark>{s.after}</div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};

/** 「从模板新建」下拉：列出笔记库/模板 下的文件，没有时提供一键创建示例模板 */
const TemplateMenu: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { listTemplates, createNoteFromTemplate, createSampleTemplates, workspacePath } = useAppStore();
  const [templates, setTemplates] = React.useState<{ name: string; path: string }[] | null>(null);

  React.useEffect(() => {
    listTemplates().then(setTemplates);
    const close = () => onClose();
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const templateDir = workspacePath ? `${workspacePath}${workspacePath.includes('\\') ? '\\' : '/'}模板` : '';

  return (
    <div className="popover-menu template-menu" onClick={(e) => e.stopPropagation()}>
      <div className="popover-menu__label">从模板新建</div>
      {templates === null ? (
        <div className="popover-menu__label">加载中…</div>
      ) : templates.length === 0 ? (
        <button className="popover-menu__item" onClick={async () => { await createSampleTemplates(); setTemplates(await listTemplates()); }}>
          还没有模板，创建示例模板
        </button>
      ) : (
        templates.map((t) => (
          <button key={t.path} className="popover-menu__item" onClick={() => { onClose(); createNoteFromTemplate(t.path); }}>
            <LayoutTemplate size={12} /> {t.name}
          </button>
        ))
      )}
      {templates && templates.length > 0 && (
        <>
          <div className="context-menu__divider" />
          <button className="popover-menu__item" onClick={() => { onClose(); window.api.shell.showItemInFolder(templateDir); }}>
            <FolderOpenIcon size={12} /> 打开模板文件夹
          </button>
        </>
      )}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const {
    fileTree, workspacePath, workspaceName, sidebarVisible, outline, sidebarTab,
    refreshWorkspace, starredFiles, sidebarWidth, setSidebarWidth,
    createNoteIn, createFolderIn, getNewNoteDir, setContextMenu, setSelectedNodePath, openDailyNote,
  } = useAppStore();
  const [showTemplates, setShowTemplates] = React.useState(false);

  // 右缘拖拽调整宽度：拖动期间只改 DOM，松手时才写 store，避免整棵组件树随指针移动反复渲染
  const dragRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const handleRef = React.useRef<HTMLDivElement>(null);
  const asideRef = React.useRef<HTMLElement>(null);
  const clampWidth = (w: number) => Math.min(600, Math.max(240, w));
  const onHandlePointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    handleRef.current?.classList.add('dragging');
  }, [sidebarWidth]);
  const onHandlePointerMove = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !asideRef.current) return;
    asideRef.current.style.width = `${clampWidth(dragRef.current.startWidth + (e.clientX - dragRef.current.startX))}px`;
  }, []);
  const onHandlePointerUp = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) setSidebarWidth(clampWidth(dragRef.current.startWidth + (e.clientX - dragRef.current.startX)));
    dragRef.current = null;
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    handleRef.current?.classList.remove('dragging');
  }, [setSidebarWidth]);

  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || activeEl?.getAttribute('contenteditable') === 'true') return;
      const { selectedNodePath, renamingPath, setRenamingPath, duplicateFile, deleteFile, workspacePath: root } = useAppStore.getState();
      if (!selectedNodePath || renamingPath || selectedNodePath === root) return;
      if (e.key === 'F2' || e.key === 'Enter') { e.preventDefault(); setRenamingPath(selectedNodePath); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteFile(selectedNodePath); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateFile(selectedNodePath); }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  if (!sidebarVisible) return null;

  const openRootMenu = (e: React.MouseEvent) => {
    if (!workspacePath) return;
    e.preventDefault();
    setSelectedNodePath(null);
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, node: { name: workspaceName || '笔记库', path: workspacePath, isDirectory: true } });
  };

  return (
    <aside ref={asideRef} className="sidebar" style={{ width: sidebarWidth }}>
      <div ref={handleRef} className="sidebar-resize-handle" onPointerDown={onHandlePointerDown} onPointerMove={onHandlePointerMove} onPointerUp={onHandlePointerUp} title="拖动调整宽度" />
      <div className="sidebar-content" onContextMenu={sidebarTab === 'library' ? openRootMenu : undefined}>
        {sidebarTab === 'search' ? (
          <SearchPanel />
        ) : sidebarTab === 'tags' ? (
          <TagsPanel />
        ) : sidebarTab === 'catalog' ? (
          <div className="catalog-view">
            {outline.length === 0 ? <div className="empty-state">暂无目录层级</div> : outline.map((item) => <OutlineItem key={item.id} node={item} />)}
            <BacklinksPanel />
            <RelatedPanel />
          </div>
        ) : !workspacePath ? (
          <div className="empty-state">
            <BookOpen size={28} color="var(--text-muted)" className="empty-state__icon" />
            <div className="text-sm text-secondary mb-8">笔记库未配置</div>
            <div className="hint mb-16">选一个文件夹作为笔记库，<br />所有笔记与子文件夹都在这里管理</div>
            <button onClick={() => useAppStore.getState().openDialog('settings')} className="btn btn-ghost btn-xs"><Settings size={11} /> 前往设置</button>
          </div>
        ) : (
          <>
            {starredFiles.length > 0 && (
              <div className="mb-12">
                <div className="sidebar-section-title">⭐ 收藏夹</div>
                {starredFiles.map((path) => <StarredItem key={`star-${path}`} path={path} />)}
              </div>
            )}

            <div className="tree-item library-header" title={workspacePath} onClick={() => setSelectedNodePath(null)} onContextMenu={(e) => { e.stopPropagation(); openRootMenu(e); }}>
              <BookOpen size={14} color="var(--color-brand-indigo)" />
              <span className="truncate flex-1">{workspaceName}</span>
              <button onClick={(e) => { e.stopPropagation(); createNoteIn(getNewNoteDir()); }} className="icon-btn icon-btn--sm hover-bg" title="新建笔记（在选中的文件夹里）"><FilePlus size={13} /></button>
              <div className="menu-anchor">
                <button onClick={(e) => { e.stopPropagation(); setShowTemplates((v) => !v); }} className="icon-btn icon-btn--sm hover-bg" title="从模板新建"><LayoutTemplate size={13} /></button>
                {showTemplates && <TemplateMenu onClose={() => setShowTemplates(false)} />}
              </div>
              <button onClick={(e) => { e.stopPropagation(); openDailyNote(); }} className="icon-btn icon-btn--sm hover-bg" title="今日日记 (⇧⌘D)"><CalendarDays size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); createFolderIn(getNewNoteDir()); }} className="icon-btn icon-btn--sm hover-bg" title="新建文件夹"><FolderPlus size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); refreshWorkspace(); }} className="icon-btn icon-btn--sm hover-bg" title="刷新"><RotateCw size={12} /></button>
            </div>

            <div className="workspace-tree">
              {fileTree.length === 0 ? (
                <div className="tree-empty tree-empty--root">还没有笔记，点上方 ＋ 新建一篇</div>
              ) : (
                fileTree.map((node) => <FileTreeItem key={node.path} node={node} level={1} />)
              )}
            </div>
          </>
        )}
      </div>
      <ContextMenuComponent />
    </aside>
  );
};
