import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  Heading1, Heading2, Heading3, Type, List, ListOrdered, SquareCheck, Quote, FileCode, Minus,
  Table, Image, Link, Sigma, Activity, PenTool, Calendar, Clock, Sparkles, CalendarDays, Info, TriangleAlert, ListTree, Tags,
} from 'lucide-react';
import type { SlashItem } from '../../extensions/SlashCommand';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Heading1, Heading2, Heading3, Type, List, ListOrdered, SquareCheck, Quote, FileCode, Minus,
  Table, Image, Link, Sigma, Activity, PenTool, Calendar, Clock, Sparkles, CalendarDays, Info, TriangleAlert, ListTree, Tags,
};

interface Props {
  items: SlashItem[];
  selectedIndex: number;
  /** 光标处的矩形，用来定位菜单 */
  anchor: DOMRect | null;
  onSelect: (item: SlashItem) => void;
  onHover: (index: number) => void;
}

const MENU_MAX_HEIGHT = 320;
const MENU_WIDTH = 300;

/** 斜杠命令菜单：按分组展示，键盘 / 鼠标都可选 */
export const SlashMenu: React.FC<Props> = ({ items, selectedIndex, anchor, onSelect, onHover }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // 键盘移动时让选中项保持可见
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.slash-menu__item--active')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!anchor) return null;

  const spaceBelow = window.innerHeight - anchor.bottom;
  const top = spaceBelow >= MENU_MAX_HEIGHT + 12 ? anchor.bottom + 6 : Math.max(8, anchor.top - MENU_MAX_HEIGHT - 6);
  const left = Math.min(Math.max(anchor.left, 8), window.innerWidth - MENU_WIDTH - 8);

  let flatIndex = -1;
  const groups = items.reduce<Record<string, SlashItem[]>>((acc, it) => {
    (acc[it.group] ||= []).push(it);
    return acc;
  }, {});

  return ReactDOM.createPortal(
    <div ref={listRef} className="slash-menu" style={{ top, left }} onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 ? (
        <div className="slash-menu__empty">没有匹配的命令</div>
      ) : (
        Object.entries(groups).map(([group, groupItems]) => (
          <div key={group} className="slash-menu__group">
            <div className="slash-menu__group-title">{group}</div>
            {groupItems.map((item) => {
              flatIndex += 1;
              const index = flatIndex;
              const Icon = ICONS[item.icon] ?? Type;
              return (
                <div
                  key={item.id}
                  className={`slash-menu__item ${index === selectedIndex ? 'slash-menu__item--active' : ''}`}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onSelect(item)}
                >
                  <div className="slash-menu__icon"><Icon size={16} /></div>
                  <div className="flex-1">
                    <div className="slash-menu__title">{item.title}</div>
                    <div className="slash-menu__desc">{item.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>,
    document.body,
  );
};
