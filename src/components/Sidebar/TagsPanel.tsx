import React, { useEffect, useMemo, useState } from 'react';
import { Hash, FileText, X, Pencil } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { TagCount, TaggedNote } from '../../types/window';
import { isValidTagName } from '../../../electron/shared/noteMeta';

/** 标签视图：全库的 #标签（正文）与 tags:（frontmatter），点标签看带这个标签的笔记 */
export const TagsPanel: React.FC = () => {
  const selectedTag = useAppStore((s) => s.selectedTag);
  const openTag = useAppStore((s) => s.openTag);
  const openFileByPath = useAppStore((s) => s.openFileByPath);
  const libraryVersion = useAppStore((s) => s.libraryVersion);
  const workspacePath = useAppStore((s) => s.workspacePath);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [notes, setNotes] = useState<TaggedNote[]>([]);
  const [filter, setFilter] = useState('');
  /** 正在改名的标签，和输入框里的新名字 */
  const [renaming, setRenaming] = useState<{ tag: string; value: string; busy: boolean } | null>(null);
  const renameTag = useAppStore((s) => s.renameTag);
  const notify = useAppStore((s) => s.notify);

  useEffect(() => {
    let cancelled = false;
    window.api.search.tags().then((t) => { if (!cancelled) setTags(t); }).catch(() => setTags([]));
    return () => { cancelled = true; };
  }, [libraryVersion]);

  useEffect(() => {
    if (!selectedTag) { setNotes([]); return; }
    let cancelled = false;
    window.api.search.notesByTag(selectedTag).then((n) => { if (!cancelled) setNotes(n); }).catch(() => setNotes([]));
    return () => { cancelled = true; };
  }, [selectedTag, libraryVersion]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? tags.filter((t) => t.tag.toLowerCase().includes(q)) : tags;
  }, [tags, filter]);

  const startRename = (tag: string) => setRenaming({ tag, value: tag, busy: false });
  const newName = renaming?.value.trim().replace(/^#/, '') ?? '';
  const mergeInto = renaming && newName.toLowerCase() !== renaming.tag.toLowerCase() ? tags.find((t) => t.tag.toLowerCase() === newName.toLowerCase()) : undefined;
  const renameError = !renaming || !newName || newName === renaming.tag ? '' : !isValidTagName(newName) ? '标签名里不能有空格和标点，也不能是纯数字' : '';
  const confirmRename = async () => {
    if (!renaming || renaming.busy || !newName || newName === renaming.tag || renameError) return;
    setRenaming({ ...renaming, busy: true });
    const { changed, failed } = await renameTag(renaming.tag, newName);
    setRenaming(null);
    notify(`${mergeInto ? `#${renaming.tag} 已并入 #${newName}` : `#${renaming.tag} 已改为 #${newName}`}，改了 ${changed} 篇笔记${failed ? `，${failed} 篇没改成（文件读写失败）` : ''}。改错了可以在每篇的版本历史里恢复。`, 8000);
  };

  const relative = (p: string) => (workspacePath && p.startsWith(workspacePath) ? p.slice(workspacePath.length + 1) : p);

  return (
    <div className="tags-panel">
      <div className="search-panel__input-wrap">
        <Hash size={13} color="var(--text-muted)" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选标签…" className="search-panel__input" />
      </div>
      <div className="search-panel__status">{tags.length ? `${tags.length} 个标签` : ''}</div>

      {tags.length === 0 ? (
        <div className="tree-empty tree-empty--root">
          还没有标签。在正文里写 <code>#标签</code>，或在文档开头的属性里写 <code>tags: [读书, 想法]</code>，这里会自动汇总。
        </div>
      ) : (
        <div className="tags-panel__cloud">
          {visible.map((t) => (
            <button
              key={t.tag}
              className={`tags-panel__tag ${selectedTag?.toLowerCase() === t.tag.toLowerCase() ? 'tags-panel__tag--active' : ''}`}
              style={{ marginLeft: (t.tag.split('/').length - 1) * 12 }}
              onClick={() => openTag(selectedTag?.toLowerCase() === t.tag.toLowerCase() ? null : t.tag)}
              onContextMenu={(e) => { e.preventDefault(); startRename(t.tag); }}
              title={`#${t.tag}（右键改名）`}
            >
              <span className="truncate">#{t.tag.split('/').pop()}</span>
              <span className="tags-panel__count">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {renaming && (
        <div className="tags-panel__rename">
          <div className="tags-panel__rename-label">把 <b>#{renaming.tag}</b> 改成</div>
          <div className="search-panel__input-wrap">
            <Hash size={13} color="var(--text-muted)" />
            <input
              autoFocus
              className="search-panel__input"
              value={renaming.value}
              disabled={renaming.busy}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') { e.preventDefault(); void confirmRename(); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null); }
              }}
            />
          </div>
          <div className={`tags-panel__rename-hint ${renameError ? 'tags-panel__rename-hint--error' : ''}`}>
            {renaming.busy ? '正在改写笔记…'
              : renameError ? renameError
              : mergeInto ? `#${mergeInto.tag} 已经有 ${mergeInto.count} 篇了——回车后两个标签合并成一个`
              : '全库用到它的地方一起改，子标签跟着变。回车确认，Esc 取消'}
          </div>
        </div>
      )}

      {selectedTag && (
        <div className="tags-panel__notes">
          <div className="sidebar-section-title tags-panel__notes-head">
            <span className="truncate flex-1">#{selectedTag} · {notes.length} 篇</span>
            <button className="icon-btn icon-btn--sm hover-bg" onClick={() => startRename(selectedTag)} title="改名，或并入另一个标签"><Pencil size={11} /></button>
            <button className="icon-btn icon-btn--sm hover-bg" onClick={() => openTag(null)} title="取消选择"><X size={12} /></button>
          </div>
          {notes.length === 0 ? (
            <div className="tree-empty tree-empty--root">没有带这个标签的笔记（保存后才会计入）。</div>
          ) : (
            notes.map((n) => (
              <div key={n.path} className="search-result" onClick={() => openFileByPath(n.path)} title={n.path}>
                <div className="search-result__title"><FileText size={12} /> <span className="truncate flex-1">{n.title}</span></div>
                <div className="search-result__path truncate">{relative(n.path)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
