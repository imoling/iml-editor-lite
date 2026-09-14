import React, { useEffect, useRef } from 'react';
import { X, ChevronDown, ChevronUp, Replace, Search, CaseSensitive } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/**
 * 查找 / 替换面板。只维护输入状态，真正的高亮、定位、替换由当前编辑器
 * （富文本 SearchExtension / 源码 CodeMirror search）响应 store 中的 search 与 searchCommand 完成。
 */
export const FindReplacePanel: React.FC = () => {
  const findVisible = useAppStore((s) => s.findVisible);
  const replaceVisible = useAppStore((s) => s.replaceVisible);
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);
  const sendSearchCommand = useAppStore((s) => s.sendSearchCommand);
  const closeSearch = useAppStore((s) => s.closeSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (findVisible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [findVisible, replaceVisible]);

  if (!findVisible) return null;

  const hasQuery = search.query.length > 0;
  const noResult = hasQuery && search.total === 0;
  const countText = !hasQuery ? '' : noResult ? '无结果' : `${search.current} / ${search.total}`;

  const onFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); sendSearchCommand(e.shiftKey ? 'prev' : 'next'); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  };
  const onReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); sendSearchCommand(e.metaKey || e.ctrlKey ? 'replaceAll' : 'replace'); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  };

  return (
    <div className="find-panel">
      <div className="row gap-6">
        <Search size={14} color="var(--text-muted)" />
        <input ref={inputRef} value={search.query} onChange={(e) => setSearch({ query: e.target.value })} onKeyDown={onFindKeyDown} placeholder="查找…" className="find-panel__input" />
        <span className={`find-panel__count ${noResult ? 'find-panel__count--none' : ''}`}>{countText}</span>
        <button title="区分大小写" onClick={() => setSearch({ caseSensitive: !search.caseSensitive })} className={`icon-btn find-panel__btn ${search.caseSensitive ? 'find-panel__btn--on' : ''}`}>
          <CaseSensitive size={14} />
        </button>
        <button title="上一个 (⇧↵)" onClick={() => sendSearchCommand('prev')} disabled={!hasQuery} className="icon-btn find-panel__btn"><ChevronUp size={14} /></button>
        <button title="下一个 (↵)" onClick={() => sendSearchCommand('next')} disabled={!hasQuery} className="icon-btn find-panel__btn"><ChevronDown size={14} /></button>
        <button title="关闭 (Esc)" onClick={closeSearch} className="icon-btn find-panel__btn"><X size={14} /></button>
      </div>

      {replaceVisible && (
        <div className="row gap-6">
          <Replace size={14} color="var(--text-muted)" />
          <input value={search.replacement} onChange={(e) => setSearch({ replacement: e.target.value })} onKeyDown={onReplaceKeyDown} placeholder="替换为…" className="find-panel__input" />
          <button onClick={() => sendSearchCommand('replace')} disabled={!hasQuery || search.total === 0} title="替换当前 (↵)" className="btn btn-surface find-panel__action">替换</button>
          <button onClick={() => sendSearchCommand('replaceAll')} disabled={!hasQuery || search.total === 0} title="全部替换 (⌘↵)" className="btn btn-primary find-panel__action">全部</button>
        </div>
      )}
    </div>
  );
};
