import React from 'react';
import { X } from 'lucide-react';

interface StyleSelectorProps {
  onSelect: (style: string) => void;
  onCancel: () => void;
}

const STYLES = [
  { id: 'professional', label: '专业 (Professional)', desc: '正式、稳重，适合文档和汇报', color: 'var(--color-accent-indigo)' },
  { id: 'literary', label: '文学 (Literary)', desc: '优美、感性，适合随感和创作', color: 'var(--color-accent-green)' },
  { id: 'concise', label: '简洁 (Concise)', desc: '精炼、直接，拒绝冗余', color: 'var(--color-accent-orange)' },
  { id: 'humorous', label: '幽默 (Humorous)', desc: '风趣、亲和，适合社交分享', color: 'var(--color-accent-red)' },
];

/** AI 润色风格选择 */
export const StyleSelector: React.FC<StyleSelectorProps> = ({ onSelect, onCancel }) => (
  <div className="modal-backdrop modal-backdrop--light">
    <div className="modal-card modal-card--dialog style-selector">
      <div className="row row--between">
        <h3 className="modal-title modal-title--dialog">选择润色风格</h3>
        <button onClick={onCancel} className="icon-btn"><X size={18} /></button>
      </div>
      <div className="col gap-10">
        {STYLES.map((s) => (
          <button key={s.id} onClick={() => onSelect(s.id)} className="style-option" style={{ ['--style-color' as any]: s.color }}>
            <span className="style-option__label">{s.label}</span>
            <span className="style-option__desc">{s.desc}</span>
          </button>
        ))}
      </div>
    </div>
  </div>
);
