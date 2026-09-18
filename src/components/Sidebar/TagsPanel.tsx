import React, { useEffect, useMemo, useState } from 'react';
import { Hash, FileText, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { TagCount, TaggedNote } from '../../types/window';

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
              title={`#${t.tag}`}
            >
              <span className="truncate">#{t.tag.split('/').pop()}</span>
              <span className="tags-panel__count">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {selectedTag && (
        <div className="tags-panel__notes">
          <div className="sidebar-section-title tags-panel__notes-head">
            <span className="truncate flex-1">#{selectedTag} · {notes.length} 篇</span>
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
