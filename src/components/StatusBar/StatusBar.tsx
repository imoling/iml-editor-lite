import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { Minus, Plus, Loader2, ChevronUp } from 'lucide-react';

const ZOOM_OPTIONS = [300, 200, 150, 125, 100, 75, 50, 25];
const CJK_RE = /[一-龥぀-ヿ＀-￯ᄀ-ᇿ㄰-㆏ꓐ-꓿가-힯]/g;

/** 中西文混排的字数：CJK 按字计，其余按空白分词 */
function countWords(content: string) {
  const cjkCount = content.match(CJK_RE)?.length ?? 0;
  const nonCjk = content.replace(CJK_RE, ' ').trim();
  const westernWords = nonCjk ? nonCjk.split(/\s+/).length : 0;
  return { words: cjkCount + westernWords, lines: content.split('\n').length };
}

export const StatusBar: React.FC = () => {
  const { mode, toggleMode, activeTabId, tabs, statusBarVisible, aiStatus, zoom, setZoom } = useAppStore();
  const [showZoomMenu, setShowZoomMenu] = React.useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find(t => t.id === activeTabId);

  useEffect(() => {
    if (!showZoomMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowZoomMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showZoomMenu]);

  if (!statusBarVisible) return null;

  const stats = activeTab ? countWords(activeTab.content || '') : null;

  return (
    <footer className={`statusbar ${aiStatus.generating ? 'statusbar-ai' : ''}`}>
      {aiStatus.generating && <div className="statusbar-shimmer" />}

      <div className="statusbar-section">
        {stats ? (
          <>
            <span>{stats.words.toLocaleString()} 字</span>
            <span>共 {stats.lines} 行</span>
          </>
        ) : (
          <span className="statusbar-dim">未选择文档</span>
        )}
      </div>

      {aiStatus.generating && (
        <div className="statusbar-section statusbar-ai-status">
          <div className="row gap-6 text-brand">
            <Loader2 size={13} className="animate-spin" />
            <span className="text-xs fw-500">AI 正在生成内容...</span>
          </div>
          <button onClick={() => aiStatus.onStop?.()} className="statusbar-stop">停止</button>
        </div>
      )}

      <div className="statusbar-section statusbar-section--right">
        <span>UTF-8</span>

        <div ref={menuRef} className="zoom-control">
          {showZoomMenu && (
            <div className="popover-menu zoom-menu">
              {ZOOM_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => { setZoom(opt); setShowZoomMenu(false); }}
                  className={`popover-menu__item ${zoom === opt ? 'popover-menu__item--active' : ''}`}
                >
                  {opt}%
                  {zoom === opt && <span className="zoom-menu__dot" />}
                </button>
              ))}
            </div>
          )}

          <div className="zoom-value" onClick={() => setShowZoomMenu(!showZoomMenu)}>
            {zoom}%
            <ChevronUp size={10} className={`zoom-value__chevron ${showZoomMenu ? 'zoom-value__chevron--open' : ''}`} />
          </div>

          <div className="row gap-2">
            <button onClick={() => setZoom(Math.max(10, zoom - 10))} title="缩小" className="icon-btn zoom-step"><Minus size={13} /></button>
            <input
              type="range" min="10" max="200" value={zoom}
              onChange={(e) => setZoom(parseInt(e.target.value))}
              className="zoom-slider"
            />
            <button onClick={() => setZoom(Math.min(400, zoom + 10))} title="放大" className="icon-btn zoom-step"><Plus size={13} /></button>
          </div>
        </div>

        <span className={`mode-indicator ${mode}`} onClick={toggleMode} title="点击切换编辑模式">
          {mode === 'word' ? '富文本模式' : 'MD 预览模式'}
        </span>
      </div>
    </footer>
  );
};
