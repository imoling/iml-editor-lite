import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, Loader2, BookOpen, Activity, FileCode, ImagePlus } from 'lucide-react';

type Mode = 'text' | 'mermaid' | 'svg' | 'image';

interface AIPaletteProps {
  onClose: () => void;
  onAction: (prompt: string, useContext: boolean, mode: Mode) => void;
  onStop?: () => void;
  loading?: boolean;
}

const MODE_BUTTONS: { mode: Mode; label: string; icon: React.ReactNode; tone: string }[] = [
  { mode: 'mermaid', label: '流程图', icon: <Activity size={14} />, tone: '' },
  { mode: 'svg', label: '插图', icon: <FileCode size={14} />, tone: 'pill-toggle--orange' },
  { mode: 'image', label: 'AI 图片', icon: <ImagePlus size={14} />, tone: 'pill-toggle--green' },
];

/** 空行行首唤起的 AI 气泡 */
export const AIPalette: React.FC<AIPaletteProps> = ({ onClose, onAction, onStop, loading }) => {
  const [input, setInput] = useState('');
  const [useContext, setUseContext] = useState(false);
  const [activeMode, setActiveMode] = useState<Mode>('text');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!input.trim() || loading) return;
    onAction(input, useContext, activeMode);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="ai-palette" onClick={(e) => e.stopPropagation()}>
      <div className="ai-palette__input-wrap">
        <div className="ai-palette__icon">
          {loading ? <Loader2 size={18} className="animate-spin" color="var(--color-brand-indigo)" /> : <Sparkles size={18} color="var(--color-brand-indigo)" />}
        </div>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入指令让 AI 生成内容..."
          rows={1}
          className="ai-palette__input"
        />
      </div>
      <div className="ai-palette__bar">
        <div className="row gap-8">
          <button
            onClick={() => setUseContext((v) => !v)}
            title={useContext ? '已启用：结合当前文档内容生成' : '启用：结合当前文档内容生成'}
            className={`pill-toggle ${useContext ? 'pill-toggle--on' : ''}`}
          >
            <BookOpen size={14} /> 结合上下文
          </button>
          <div className="ai-palette__sep" />
          {MODE_BUTTONS.map((b) => (
            <button
              key={b.mode}
              onClick={() => setActiveMode(activeMode === b.mode ? 'text' : b.mode)}
              className={`pill-toggle ${b.tone} ${activeMode === b.mode ? 'pill-toggle--on' : ''}`}
            >
              {b.icon} {b.label}
            </button>
          ))}
        </div>

        {loading ? (
          <button onClick={onStop} className="ai-palette__stop"><Loader2 size={13} className="animate-spin" /> 停止</button>
        ) : (
          <button onClick={submit} disabled={!input.trim()} className="ai-palette__send"><Send size={13} /> 发送</button>
        )}
      </div>
    </div>
  );
};
