import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { SemanticHit, SemanticState } from '../../types/window';

/** 订阅语义索引状态（相关笔记与搜索面板共用） */
export function useSemanticState(): SemanticState | null {
  const [state, setState] = useState<SemanticState | null>(null);
  useEffect(() => {
    let alive = true;
    window.api.semantic.getState().then((s) => { if (alive && s) setState(s); }).catch(() => {});
    const off = window.api.semantic.onState((s) => { if (alive) setState(s); });
    return () => { alive = false; off(); };
  }, []);
  return state;
}

export const semanticReady = (s: SemanticState | null) =>
  !!s && s.enabled && s.runtimeInstalled && !!s.models.find((m) => m.id === s.modelId)?.downloaded;

/** 当前笔记的相关笔记：由本机嵌入模型按语义相近程度推荐（不依赖 [[链接]] 或相同的词） */
export const RelatedPanel: React.FC = () => {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const libraryVersion = useAppStore((s) => s.libraryVersion);
  const openFileByPath = useAppStore((s) => s.openFileByPath);
  const openDialog = useAppStore((s) => s.openDialog);
  const aiEnabled = useAppStore((s) => s.aiEnabled);
  const state = useSemanticState();
  const [hits, setHits] = useState<SemanticHit[]>([]);
  const ready = semanticReady(state);
  const indexed = state?.indexed ?? 0;

  useEffect(() => {
    if (!ready || !activeTabId || activeTabId.startsWith('new-')) { setHits([]); return; }
    let cancelled = false;
    window.api.semantic.related(activeTabId, 6).then((r) => { if (!cancelled) setHits(r); }).catch(() => setHits([]));
    return () => { cancelled = true; };
    // indexed：建库进行中时，随着进度推进刷新推荐
  }, [activeTabId, libraryVersion, ready, indexed]);

  if (!activeTabId || !aiEnabled) return null;

  return (
    <div className="backlinks related">
      <div className="sidebar-section-title">✦ 相关笔记{hits.length ? ` · ${hits.length}` : ''}</div>
      {!ready ? (
        <div className="tree-empty tree-empty--root">
          开启后，这里会按「意思相近」推荐笔记，全程在本机完成。
          <button className="btn-link" onClick={() => openDialog('semantic-config')}>去开启</button>
        </div>
      ) : state?.indexing && hits.length === 0 ? (
        <div className="tree-empty tree-empty--root">正在建立语义索引 {state.indexed} / {state.total}…</div>
      ) : hits.length === 0 ? (
        <div className="tree-empty tree-empty--root">暂时没有足够相近的笔记。</div>
      ) : (
        hits.map((h) => (
          <div key={h.path} className="search-result" onClick={() => openFileByPath(h.path)} title={h.path}>
            <div className="search-result__title">
              <span className="truncate flex-1">{h.title}</span>
              <span className="related__score" title="语义相似度">{Math.round(h.score * 100)}%</span>
            </div>
            {h.snippet && <div className="search-result__snippet">{h.snippet}</div>}
          </div>
        ))
      )}
    </div>
  );
};
