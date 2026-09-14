import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  selected: boolean;
  isEditing: boolean;
  viewMode: 'preview' | 'code';
  onHeaderClick: () => void;
  onPreview: () => void;
  onCode: () => void;
  codeIcon: React.ReactNode;
  previewIcon: React.ReactNode;
  rendering?: boolean;
  error?: string | null;
  children: React.ReactNode;
}

/** Mermaid / SVG 块共用的卡片壳：顶栏（预览 / 代码切换 + 状态）与内容区 */
export const BlockCard: React.FC<Props> = ({ selected, isEditing, viewMode, onHeaderClick, onPreview, onCode, codeIcon, previewIcon, rendering, error, children }) => (
  <div className={`block-card ${selected && !isEditing ? 'block-card--selected' : ''}`}>
    <div className="block-card__header" onClick={onHeaderClick}>
      <div className="block-card__tabs">
        <button onClick={(e) => { e.stopPropagation(); onPreview(); }} className={`block-card__tab ${viewMode === 'preview' ? 'block-card__tab--active' : ''}`}>
          {previewIcon}<span>预览</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onCode(); }} className={`block-card__tab ${viewMode === 'code' ? 'block-card__tab--active' : ''}`}>
          {codeIcon}<span>代码</span>
        </button>
      </div>
      <div className="block-card__status">
        {rendering && <Loader2 size={14} className="animate-spin text-brand" />}
        {error && <div className="block-card__error"><AlertCircle size={13} /><span>{error}</span></div>}
      </div>
    </div>
    <div className="col">{children}</div>
  </div>
);

/** 预览区底部的拖拽调高手柄 */
export const ResizeHandle: React.FC<{ resizing: boolean; onMouseDown: (e: React.MouseEvent) => void }> = ({ resizing, onMouseDown }) => (
  <div className="block-card__resize" onMouseDown={onMouseDown}>
    <div className={`block-card__resize-bar ${resizing ? 'block-card__resize-bar--active' : ''}`} />
  </div>
);

/** 拖拽调整预览高度的通用逻辑 */
export function useResizableHeight(initial: string, previewRef: React.RefObject<HTMLDivElement | null>, commit: (height: string) => void) {
  const [isResizing, setIsResizing] = React.useState(false);
  const [currentHeight, setCurrentHeight] = React.useState<string>(initial || 'auto');

  React.useEffect(() => {
    setCurrentHeight(initial || 'auto');
  }, [initial]);

  const onMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = previewRef.current?.offsetHeight || 0;
    const onMouseMove = (moveEvent: MouseEvent) => {
      setCurrentHeight(`${Math.max(120, startHeight + (moveEvent.clientY - startY))}px`);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (previewRef.current) commit(`${previewRef.current.offsetHeight}px`);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [commit, previewRef]);

  return { isResizing, currentHeight, onMouseDown };
}
