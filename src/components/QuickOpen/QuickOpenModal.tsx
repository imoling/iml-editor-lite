import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, FilePlus, CornerDownLeft } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { rankNotes, type QuickOpenNote } from '../../utils/quickOpen';

interface Props {
  onClose: () => void;
}

/** 把标题按命中区间切开，命中的部分高亮 */
const Highlighted: React.FC<{ text: string; ranges: [number, number][] }> = ({ text, ranges }) => {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(<mark key={i} className="quick-open__hl">{text.slice(from, to)}</mark>);
    at = to;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
};

/**
 * 快速打开（⌘T）：敲几个字跳到笔记。没输入时列最近打开的；一篇都没匹配上时，回车直接用这个名字新建。
 */
export const QuickOpenModal: React.FC<Props> = ({ onClose }) => {
  const openFileByPath = useAppStore((s) => s.openFileByPath);
  const openWikiLink = useAppStore((s) => s.openWikiLink);
  const recentFiles = useAppStore((s) => s.recentFiles);
  const root = useAppStore((s) => s.workspacePath || s.defaultLibraryPath || '');

  const [notes, setNotes] = useState<QuickOpenNote[] | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    window.api.search.listNotes().then((list) => { if (alive) setNotes(list); }).catch(() => { if (alive) setNotes([]); });
    return () => { alive = false; };
  }, []);

  const hits = useMemo(() => rankNotes(notes || [], query, { root, recentPaths: recentFiles }), [notes, query, root, recentFiles]);
  const canCreate = notes !== null && hits.length === 0 && query.trim().length > 0;
  // 没输入时，rankNotes 把最近打开的排在最前面；数一下有几条，好在交界处分组
  const recentCount = useMemo(() => {
    if (query.trim()) return 0;
    const recent = new Set(recentFiles);
    return hits.filter((h) => recent.has(h.path)).length;
  }, [hits, query, recentFiles]);
  const rowCount = canCreate ? 1 : hits.length;

  // 结果变了就回到第一条
  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('.quick-open__row--active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (index: number) => {
    if (canCreate) {
      onClose();
      void openWikiLink(query.trim());
      return;
    }
    const hit = hits[index];
    if (!hit) return;
    onClose();
    void openFileByPath(hit.path);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 输入法还在组字时，回车是用来确认候选词的，不能当成「打开」
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      if (rowCount > 0) setActive((i) => (i + 1) % rowCount);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      if (rowCount > 0) setActive((i) => (i - 1 + rowCount) % rowCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  };

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <div className="quick-open" onMouseDown={(e) => e.stopPropagation()}>
        <div className="quick-open__input-wrap">
          <Search size={16} className="quick-open__icon" />
          <input
            autoFocus
            className="quick-open__input"
            placeholder="输入笔记名，回车打开…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
        </div>

        <div className="quick-open__list" ref={listRef}>
          {notes === null ? (
            <div className="quick-open__empty">正在读取笔记库…</div>
          ) : canCreate ? (
            <div className="quick-open__row quick-open__row--active" onClick={() => choose(0)}>
              <FilePlus size={14} className="quick-open__row-icon" />
              <span className="quick-open__title">新建笔记「{query.trim()}」</span>
              <span className="quick-open__enter"><CornerDownLeft size={12} /></span>
            </div>
          ) : hits.length === 0 ? (
            <div className="quick-open__empty">笔记库里还没有笔记</div>
          ) : (
            <>
              {recentCount > 0 && <div className="quick-open__section">最近打开</div>}
              {hits.map((hit, i) => (
                <React.Fragment key={hit.path}>
                {/* 没输入时前几条是最近打开的，后面是全库 —— 在交界处分个组 */}
                {recentCount > 0 && i === recentCount && <div className="quick-open__section">全部笔记</div>}
                <div
                  className={`quick-open__row ${i === active ? 'quick-open__row--active' : ''}`}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={() => choose(i)}
                  title={hit.path}
                >
                  <FileText size={14} className="quick-open__row-icon" />
                  <span className="quick-open__title"><Highlighted text={hit.title} ranges={hit.ranges} /></span>
                  {hit.folder && <span className="quick-open__folder">{hit.folder}</span>}
                  {i === active && <span className="quick-open__enter"><CornerDownLeft size={12} /></span>}
                </div>
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        <div className="quick-open__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <span className="quick-open__foot-tip">用空格隔开多个词，如「周会 项目」</span>
        </div>
      </div>
    </div>
  );
};
