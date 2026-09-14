import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { FileText, FilePlus } from 'lucide-react';
import type { WikiLinkCandidate } from '../../extensions/WikiLinkSuggestion';

interface Props {
  items: WikiLinkCandidate[];
  selectedIndex: number;
  anchor: DOMRect | null;
  onSelect: (item: WikiLinkCandidate) => void;
  onHover: (index: number) => void;
}

/** `[[` 笔记名补全菜单 */
export const WikiLinkMenu: React.FC<Props> = ({ items, selectedIndex, anchor, onSelect, onHover }) => {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.slash-menu__item--active')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);
  if (!anchor) return null;

  const top = window.innerHeight - anchor.bottom >= 260 ? anchor.bottom + 6 : Math.max(8, anchor.top - 260);
  const left = Math.min(Math.max(anchor.left, 8), window.innerWidth - 300 - 8);

  return ReactDOM.createPortal(
    <div ref={listRef} className="slash-menu wiki-menu" style={{ top, left }} onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 ? (
        <div className="slash-menu__empty">输入笔记名…</div>
      ) : (
        items.map((item, index) => (
          <div
            key={item.path || `new:${item.title}`}
            className={`slash-menu__item ${index === selectedIndex ? 'slash-menu__item--active' : ''}`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(item)}
          >
            <div className="slash-menu__icon">{item.create ? <FilePlus size={14} /> : <FileText size={14} />}</div>
            <div className="flex-1">
              <div className="slash-menu__title">{item.create ? `新建「${item.title}」` : item.title}</div>
              {!item.create && <div className="slash-menu__desc truncate">{item.path.split(/[/\\]/).slice(-2).join('/')}</div>}
            </div>
          </div>
        ))
      )}
    </div>,
    document.body,
  );
};
