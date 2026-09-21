import React from 'react';
import { useAppStore, FileNode, HeadingNode, readLibraryDir } from '../../stores/appStore';
import { sortFileNodes, FILE_SORT_LABELS, FileSortMode } from '../../utils/fileSort';
import {
  ChevronDown, ChevronRight, FolderOpen, FileText, FileCode, FolderClosed,
  List, RotateCw, Folder, FilePlus, FolderPlus, ArrowUpDown, Check, X,
} from 'lucide-react';

const isMac = window.api.app.platform === 'darwin';
const REVEAL_LABEL = isMac ? '在访达中显示' : '在资源管理器中显示';
const MD_RE = /\.(md|markdown|mdown|mkd)$/i;

export const ActivityBar: React.FC = () => {
  const { sidebarTab, setSidebarTab, sidebarVisible } = useAppStore();
  const tabs = [
    { id: 'files' as const, icon: <Folder size={16} />, label: '文件', title: '打开的文件夹' },
    { id: 'outline' as const, icon: <List size={16} />, label: '大纲', title: '当前文档的大纲' },
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

/** 打开（或激活）一个标签页 */
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
    useAppStore.getState().notify(`打不开「${title}」：文件可能已被移动或删除，刷新一下文件夹试试`, 8000);
  }
}

const FileTreeItem: React.FC<{ node: FileNode; level: number }> = ({ node, level }) => {
  const { updateFileNode, activeTabId, expandedPaths, setExpanded, selectedNodePath, setSelectedNodePath, renamingPath, setRenamingPath, renameFile, setContextMenu } = useAppStore();
  const isOpen = expandedPaths.includes(node.path);
  const fileSort = useAppStore((st) => st.fileSort);
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
      </div>

      {node.isDirectory && isOpen && node.children && (
        <div className="tree-children">
          {node.children.length === 0 ? (
            <div className="tree-empty" style={{ paddingLeft: `${(level + 1) * 12 + 22}px` }}>空文件夹</div>
          ) : (
            sortFileNodes(node.children, fileSort).map((child) => <FileTreeItem key={child.path} node={child} level={level + 1} />)
          )}
        </div>
      )}
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
          <MenuItem label="新建文档" onClick={() => { done(); createNoteIn(node.path); }} />
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

/** 文件树排序方式的下拉。文件夹总在前面按名称排，这里选的是文件怎么排 */
const SortMenu: React.FC<{ current: FileSortMode; onPick: (mode: FileSortMode) => void; onClose: () => void }> = ({ current, onPick, onClose }) => {
  React.useEffect(() => {
    const close = () => onClose();
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [onClose]);
  return (
    <div className="popover-menu template-menu sort-menu" onClick={(e) => e.stopPropagation()}>
      <div className="popover-menu__label">文件的排列顺序</div>
      {(Object.keys(FILE_SORT_LABELS) as FileSortMode[]).map((mode) => (
        <button key={mode} className="popover-menu__item" onClick={() => onPick(mode)}>
          <span className="sort-menu__check">{mode === current && <Check size={12} />}</span>
          {FILE_SORT_LABELS[mode]}
        </button>
      ))}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const {
    fileTree, workspacePath, workspaceName, sidebarVisible, outline, sidebarTab,
    refreshWorkspace, sidebarWidth, setSidebarWidth,
    createNoteIn, createFolderIn, getNewNoteDir, setContextMenu, setSelectedNodePath, openDirectory, closeFolder,
  } = useAppStore();
  const [showSort, setShowSort] = React.useState(false);
  const fileSort = useAppStore((st) => st.fileSort);
  const setFileSort = useAppStore((st) => st.setFileSort);

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
      // 别人已经处理过的按键不再管。
      // 判断「是不是在输入」看的是按键从哪发出来的，不是此刻焦点在哪：很多输入框一回车就消失了（弹窗关闭、卡片重画），
      // 等事件冒泡到这里焦点早已回到 body，文件树里选中的文件会误进重命名状态
      if (e.defaultPrevented) return;
      const from = e.target as HTMLElement | null;
      if (from?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
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
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, node: { name: workspaceName || '文件夹', path: workspacePath, isDirectory: true } });
  };

  return (
    <aside ref={asideRef} className="sidebar" style={{ width: sidebarWidth }}>
      <div ref={handleRef} className="sidebar-resize-handle" onPointerDown={onHandlePointerDown} onPointerMove={onHandlePointerMove} onPointerUp={onHandlePointerUp} title="拖动调整宽度" />
      <div className="sidebar-content" onContextMenu={sidebarTab === 'files' ? openRootMenu : undefined}>
        {sidebarTab === 'outline' ? (
          <div className="catalog-view">
            {outline.length === 0 ? <div className="empty-state">这篇文档还没有标题</div> : outline.map((item) => <OutlineItem key={item.id} node={item} />)}
          </div>
        ) : !workspacePath ? (
          <div className="empty-state">
            <Folder size={28} color="var(--text-muted)" className="empty-state__icon" />
            <div className="text-sm text-secondary mb-8">还没有打开文件夹</div>
            <div className="hint mb-16">打开一个文件夹，<br />里面的文档会列在这里，方便来回切换</div>
            <button onClick={() => void openDirectory()} className="btn btn-ghost btn-xs"><FolderOpen size={11} /> 打开文件夹…</button>
          </div>
        ) : (
          <>
            <div className="tree-item library-header" title={workspacePath} onClick={() => setSelectedNodePath(null)} onContextMenu={(e) => { e.stopPropagation(); openRootMenu(e); }}>
              <Folder size={14} color="var(--color-brand-indigo)" />
              <span className="truncate flex-1">{workspaceName}</span>
              <button onClick={(e) => { e.stopPropagation(); createNoteIn(getNewNoteDir()); }} className="icon-btn icon-btn--sm hover-bg" title="新建文档（在选中的文件夹里）"><FilePlus size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); createFolderIn(getNewNoteDir()); }} className="icon-btn icon-btn--sm hover-bg" title="新建文件夹"><FolderPlus size={13} /></button>
              <div className="menu-anchor">
                <button onClick={(e) => { e.stopPropagation(); setShowSort((v) => !v); }} className="icon-btn icon-btn--sm hover-bg" title={`排序：${FILE_SORT_LABELS[fileSort]}`}><ArrowUpDown size={12} /></button>
                {showSort && <SortMenu current={fileSort} onPick={(m) => { setFileSort(m); setShowSort(false); }} onClose={() => setShowSort(false)} />}
              </div>
              <button onClick={(e) => { e.stopPropagation(); refreshWorkspace(); }} className="icon-btn icon-btn--sm hover-bg" title="刷新"><RotateCw size={12} /></button>
              <button onClick={(e) => { e.stopPropagation(); closeFolder(); }} className="icon-btn icon-btn--sm hover-bg" title="关闭文件夹（打开的标签页不受影响）"><X size={12} /></button>
            </div>

            <div className="workspace-tree">
              {fileTree.length === 0 ? (
                <div className="tree-empty tree-empty--root">这个文件夹里还没有文档，点上方 ＋ 新建一篇</div>
              ) : (
                sortFileNodes(fileTree, fileSort).map((node) => <FileTreeItem key={node.path} node={node} level={1} />)
              )}
            </div>
          </>
        )}
      </div>
      <ContextMenuComponent />
    </aside>
  );
};
