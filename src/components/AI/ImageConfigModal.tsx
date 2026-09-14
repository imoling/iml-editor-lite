import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useAppStore, type ImageGenConfig } from '../../stores/appStore';

interface Props {
  onClose: () => void;
}

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', desc: 'Imagen / Flash，需境外访问' },
  { id: 'volcengine', name: '火山引擎 豆包', desc: 'Seedream 系列，国内稳定' },
  { id: 'minimax', name: 'MiniMax 海螺', desc: '国产文生图大模型' },
  { id: 'custom', name: '自定义端点', desc: 'OpenAI 兼容接口' },
] as const;

const GEMINI_MODELS = [
  { id: 'imagen-4.0-generate-001', name: 'Imagen 4.0' },
  { id: 'imagen-4.0-ultra-generate-001', name: 'Imagen 4.0 Ultra' },
  { id: 'gemini-2.0-flash-exp-image-generation', name: 'Flash 2.0' },
];
const VOLC_MODELS = [
  { id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0' },
  { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' },
  { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0' },
];

export const ImageConfigModal: React.FC<Props> = ({ onClose }) => {
  const isStandalone = new URLSearchParams(window.location.search).get('window') === 'image-config';
  const isMac = window.api.app.platform === 'darwin';
  const { imageGenConfig, setImageGenConfig } = useAppStore();

  // 本地状态缓冲（standalone 模式下不立即写 store）
  const [local, setLocal] = useState<ImageGenConfig>({ ...imageGenConfig });

  // standalone 模式：从磁盘加载已保存的配置（store 此时是默认值）
  useEffect(() => {
    if (!isStandalone) return;
    window.api.app.getSettings().then((s: any) => {
      if (s?.imageGenConfig) setLocal(s.imageGenConfig);
    });
  }, []);

  const cfg = isStandalone ? local : imageGenConfig;
  const update = (patch: Partial<ImageGenConfig>) =>
    isStandalone ? setLocal((s) => ({ ...s, ...patch })) : setImageGenConfig(patch);

  const isGemini = cfg.provider === 'gemini' || cfg.provider === 'gemini-imagen' || cfg.provider === 'gemini-flash';
  const isVolc = cfg.provider === 'volcengine';

  const apiKeyPlaceholder = isGemini ? 'AIza...' : cfg.provider === 'minimax' ? 'eyJ...' : isVolc ? '火山方舟 API Key' : 'Bearer token';
  const apiKeyHint = isGemini
    ? 'aistudio.google.com → Get API key'
    : isVolc ? 'console.volcengine.com → 火山方舟 → API Key 管理'
    : cfg.provider === 'minimax' ? 'platform.minimaxi.com → API Key 管理' : '';

  const handleSave = async () => {
    // 独立窗口里的 store 是默认值，不能走 setImageGenConfig → saveSettings（会把默认外观、笔记库路径等写回覆盖真实设置）；
    // 直接合并写盘，主窗口收到 settings:changed 后会自行重载
    const current = await window.api.app.getSettings();
    await window.api.app.saveSettings({ ...current, imageGenConfig: local });
    window.close();
  };

  const presets = isGemini ? GEMINI_MODELS : isVolc ? VOLC_MODELS : null;
  const defaultModel = isGemini ? 'imagen-4.0-generate-001' : 'doubao-seedream-5-0-260128';
  const currentModel = cfg.model || defaultModel;

  return (
    <div className={isStandalone ? 'standalone' : 'modal-backdrop'} onClick={(e) => { if (!isStandalone && e.target === e.currentTarget) onClose(); }}>
      {isStandalone && <div className="standalone-drag" />}
      <div className={isStandalone ? 'standalone-card' : 'modal-card'}>
        <div className={isStandalone ? 'standalone-scroll' : ''}>
          {(!isStandalone || !isMac) && (
            <button onClick={onClose} className="modal-close"><X size={20} /></button>
          )}

          <header className="modal-header">
            <h1 className="modal-title">图片生成配置</h1>
          </header>

          <label className="field-label">模型提供商</label>
          <div className="option-grid mb-20">
            {PROVIDERS.map((p) => {
              const active = cfg.provider === p.id || (p.id === 'gemini' && (cfg.provider === 'gemini-imagen' || cfg.provider === 'gemini-flash'));
              return (
                <button key={p.id} onClick={() => update({ provider: p.id })} className={`option-card ${active ? 'option-card--active' : ''}`}>
                  <div className="option-card__title">{p.name}</div>
                  <div className="option-card__desc">{p.desc}</div>
                </button>
              );
            })}
          </div>

          <label className="field-label">API Key</label>
          <input type="password" value={cfg.apiKey} onChange={(e) => update({ apiKey: e.target.value })} placeholder={apiKeyPlaceholder} className="field-input" />
          {apiKeyHint && <div className="field-hint">{apiKeyHint}</div>}

          {presets && (
            <>
              <label className="field-label">模型</label>
              <div className="chip-row mb-8">
                {presets.map((m) => (
                  <button key={m.id} onClick={() => update({ model: m.id })} className={`chip ${currentModel === m.id ? 'chip--active' : ''}`}>{m.name}</button>
                ))}
              </div>
              <input type="text" value={currentModel} onChange={(e) => update({ model: e.target.value })} placeholder="输入模型 ID..." className="field-input field-input--mono" />
            </>
          )}

          {cfg.provider === 'custom' && (
            <>
              <label className="field-label">API 端点</label>
              <input type="text" value={cfg.endpoint} onChange={(e) => update({ endpoint: e.target.value })} placeholder="https://api.example.com/v1/images/generations" className="field-input" />
              <label className="field-label">模型名称</label>
              <input type="text" value={cfg.model} onChange={(e) => update({ model: e.target.value })} placeholder="dall-e-3 / stable-diffusion-xl / ..." className="field-input" />
            </>
          )}

          <div className="info-box">🔒 API Key 加密后保存在本机（macOS 钥匙串 / Windows DPAPI），不会上传。</div>

          {!isStandalone && <div className="hint text-center mt-16">配置变更自动生效</div>}
        </div>

        {isStandalone && (
          <div className="standalone-footer">
            <button onClick={handleSave} className="btn btn-primary btn-block">保存</button>
            <button onClick={() => window.close()} className="btn btn-secondary btn-wide">取消</button>
          </div>
        )}
      </div>
    </div>
  );
};
