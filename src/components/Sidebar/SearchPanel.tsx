import React, { useEffect, useRef, useState } from 'react';
import { Search, FileText, Loader2, Sparkles } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSemanticState, semanticReady } from './RelatedPanel';
import type { SemanticHit } from '../../types/window';

type Result = Awaited<ReturnType<typeof window.api.search.query>>[number];

/** 跨笔记全文搜索（⌘⇧F）：主进程的内存索引负责匹配，这里只管输入与结果 */
export const SearchPanel: React.FC = () => {
  const focusNonce = useAppStore((s) => s.globalSearchFocus);
  const workspacePath = useAppStore((s) => s.workspacePath);
  const openFileByPath = useAppStore((s) => s.openFileByPath);
  const showFindWith = useAppStore((s) => s.showFindWith);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<{ count: number; building: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const aiEnabled = useAppStore((s) => s.aiEnabled);
  const semantic = useSemanticState();
  const semanticOn = aiEnabled && semanticReady(semantic);
  const [semanticHits, setSemanticHits] = useState<SemanticHit[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    window.api.search.status().then(setStatus).catch(() => setStatus(null));
  }, [focusNonce]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        setResults(await window.api.search.query(q, 50));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // 语义结果：比关键词慢一拍（要过一次嵌入模型），单独防抖，不阻塞关键词结果
  useEffect(() => {
    const q = query.trim();
    if (!semanticOn || q.length < 2) { setSemanticHits([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const hits = await window.api.semantic.search(q, 12);
        if (!cancelled) setSemanticHits(hits);
      } catch {
        if (!cancelled) setSemanticHits([]);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, semanticOn]);

  const relative = (p: string) => (workspacePath && p.startsWith(workspacePath) ? p.slice(workspacePath.length + 1) : p);

  const open = async (r: Result) => {
    await openFileByPath(r.path);
    // 打开后把关键词交给文档内查找，直接高亮定位
    showFindWith(query.trim());
  };

  return (
    <div className="search-panel">
      <div className="search-panel__input-wrap">
        <Search size={13} color="var(--text-muted)" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
          placeholder="搜索所有笔记…"
          className="search-panel__input"
        />
        {searching && <Loader2 size={12} className="animate-spin text-muted" />}
      </div>
      <div className="search-panel__status">
        {status?.building ? '正在建立索引…' : status ? `${status.count} 篇笔记已索引` : ''}
        {query.trim() && !searching && ` · ${results.length} 个结果`}
      </div>
      <div className="search-panel__results">
        {query.trim() && !searching && results.length === 0 && semanticHits.length === 0 && <div className="empty-state">没有找到「{query.trim()}」</div>}
        {results.map((r) => (
          <div key={r.path} className="search-result" onClick={() => open(r)} title={r.path}>
            <div className="search-result__title"><FileText size={12} /> <span className="truncate flex-1">{r.title}</span><span className="search-result__count">{r.count}</span></div>
            <div className="search-result__path truncate">{relative(r.path)}</div>
            {r.snippets.map((s, i) => (
              <div key={i} className="search-result__snippet">{s.before}<mark>{s.match}</mark>{s.after}</div>
            ))}
          </div>
        ))}
        {(() => {
          // 关键词已经命中的不重复列
          const extra = semanticHits.filter((h) => !results.some((r) => r.path === h.path));
          if (!query.trim() || extra.length === 0) return null;
          return (
            <>
              <div className="sidebar-section-title search-panel__semantic-title"><Sparkles size={11} /> 意思相近 · {extra.length}</div>
              {extra.map((h) => (
                <div key={h.path} className="search-result" onClick={() => openFileByPath(h.path)} title={h.path}>
                  <div className="search-result__title"><FileText size={12} /> <span className="truncate flex-1">{h.title}</span><span className="related__score">{Math.round(h.score * 100)}%</span></div>
                  <div className="search-result__path truncate">{relative(h.path)}</div>
                  {h.snippet && <div className="search-result__snippet">{h.snippet}</div>}
                </div>
              ))}
            </>
          );
        })()}
      </div>
    </div>
  );
};
