import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CornerDownLeft } from 'lucide-react';
import { COMMANDS, rankCommands, displayShortcut, AppCommand } from '../../commands/commands';
import { Highlighted } from './QuickOpenModal';

interface Props { onClose: () => void }

const RECENT_KEY = 'iml.commandPalette.recent';
const MAX_RECENT = 6;

const loadRecent = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};

/**
 * 命令面板（⌘⇧P）：敲几个字找到要做的事，回车执行。中文、拼音首字母、英文都能搜（「导出」「dc」「export」）。
 * 样子和「快速打开」是一套，只是这里找的是命令不是笔记。现在用不了的命令（没打开笔记时的「保存」）不列出来。
 */
export const CommandPalette: React.FC<Props> = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState(loadRecent);
  const listRef = useRef<HTMLDivElement>(null);
  const isMac = window.api.app.platform === 'darwin';

  const hits = useMemo(() => rankCommands(COMMANDS, query, recent), [query, recent]);
  const recentCount = useMemo(() => (query.trim() ? 0 : hits.filter((h) => recent.includes(h.command.id)).length), [hits, query, recent]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { listRef.current?.querySelector('.quick-open__row--active')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const execute = (command: AppCommand | undefined) => {
    if (!command) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([command.id, ...recent.filter((id) => id !== command.id)].slice(0, MAX_RECENT))); } catch { /* 记不住最近用过的也不耽误执行 */ }
    // 先关面板再执行：不少命令会打开另一个弹窗，晚关的话会把人家刚打开的也关掉
    onClose();
    void command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 输入法还在组字时，回车是用来确认候选词的，不能当成「执行」
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      if (hits.length) setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      if (hits.length) setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(hits[active]?.command);
    }
  };

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <div className="quick-open command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="quick-open__input-wrap">
          <ChevronRight size={16} className="quick-open__icon" />
          <input
            autoFocus
            className="quick-open__input"
            placeholder="输入要做的事，如「导出」「专注」「dc」…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
        </div>

        <div className="quick-open__list" ref={listRef}>
          {hits.length === 0 ? (
            <div className="quick-open__empty">没有叫这个的命令。找笔记请用「快速打开」（{displayShortcut('⌘T', isMac)}）</div>
          ) : (
            hits.map((hit, i) => (
              <React.Fragment key={hit.command.id}>
                {recentCount > 0 && i === 0 && <div className="quick-open__section">最近用过</div>}
                {recentCount > 0 && i === recentCount && <div className="quick-open__section">全部命令</div>}
                <div
                  className={`quick-open__row ${i === active ? 'quick-open__row--active' : ''}`}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={() => execute(hit.command)}
                >
                  <span className="command-palette__group">{hit.command.group}</span>
                  <span className="quick-open__title"><Highlighted text={hit.command.title} ranges={hit.ranges} /></span>
                  {hit.command.shortcut && <kbd className="command-palette__keys">{displayShortcut(hit.command.shortcut, isMac)}</kbd>}
                  {i === active && <span className="quick-open__enter"><CornerDownLeft size={12} /></span>}
                </div>
              </React.Fragment>
            ))
          )}
        </div>

        <div className="quick-open__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <span className="quick-open__foot-tip">中文、拼音首字母、英文都能搜</span>
        </div>
      </div>
    </div>
  );
};
