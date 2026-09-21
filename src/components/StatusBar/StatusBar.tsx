import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { Minus, Plus, ChevronUp } from 'lucide-react';

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
  const { mode, toggleMode, activeTabId, tabs, statusBarVisible, zoom, setZoom } = useAppStore();
  const notice = useAppStore((s) => s.notice);
  const [showZoomMenu, setShowZoomMenu] = React.useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find(t => t.id === activeTabId);
  const selectionText = useAppStore((st) => st.selectionText);

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
  const selectedWords = activeTab && selectionText.trim() ? countWords(selectionText).words : 0;

  return (
    <footer className="statusbar">
      <div className="statusbar-section">
        {stats ? (
          <>
            <span>{stats.words.toLocaleString()} 字</span>
            {selectedWords > 0 && <span className="statusbar-selected" title="当前选中的字数">选中 {selectedWords.toLocaleString()} 字</span>}
            <span>共 {stats.lines} 行</span>
          </>
        ) : (
          <span className="statusbar-dim">未选择文档</span>
        )}
      </div>

      {notice && (
        // 一行放不下会被截断，悬停能看到全文（报错信息往往比较长）；「已导出」这类提示带按钮，点过就收起
        <div className="statusbar-section statusbar-notice" key={notice.id} title={notice.text}>
          <span className="statusbar-notice__text">{notice.text}</span>
          {notice.actions?.map((action) => (
            <button key={action.label} className="statusbar-notice__action" onClick={() => { action.run(); useAppStore.setState({ notice: null }); }}>{action.label}</button>
          ))}
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
