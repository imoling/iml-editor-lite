import React, { useState, useEffect } from 'react';
import { X, Moon, Sun, Monitor, Palette, Power, Save, Trash2, AlertTriangle, Coffee, Type, ImageDown, Link2, SpellCheck } from 'lucide-react';
import { useAppStore, THEME_PRESETS, EDITOR_FONTS, PAGE_WIDTHS, DEFAULT_EDITOR_PREFS, normalizeEditorPrefs, applyEditorPrefs, type EditorPrefs } from '../../stores/appStore';

type AppearanceMode = 'light' | 'dark' | 'system' | 'eye-protection';

const APPEARANCE_OPTIONS: { id: AppearanceMode; name: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'system', name: '系统', icon: Monitor },
  { id: 'light', name: '亮色', icon: Sun },
  { id: 'dark', name: '深色', icon: Moon },
  { id: 'eye-protection', name: '护眼', icon: Coffee },
];

interface Props {
  /** 主窗口内浮层模式的关闭回调；独立窗口（?window=settings）不需要 */
  onClose?: () => void;
}

/** 全局设置：改动先缓存在本地，保存时一次写盘；外观与主题改动实时预览。既可作主窗口内的浮层，也可作独立窗口 */
export const SettingsModal: React.FC<Props> = ({ onClose }) => {
  const isStandalone = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isMac = window.api.app.platform === 'darwin';
  const { setTheme, applyAppearance, loadSettings } = useAppStore();
  const isOpen = isStandalone || !!onClose;

  const [local, setLocal] = useState({
    appearanceMode: 'light' as string,
    startupBehavior: 'restore' as string,
    autoSave: false,
    themeId: 'indigo',
    editorPrefs: DEFAULT_EDITOR_PREFS as EditorPrefs,
    imageCompression: true,
    fetchLinkTitle: true,
    spellcheck: false,
  });

  // 从磁盘加载并预览
  useEffect(() => {
    if (!isOpen) return;
    window.api.app.getSettings().then((settings: any) => {
      if (!settings) return;
      setLocal({
        appearanceMode: settings.appearanceMode || 'light',
        startupBehavior: settings.startupBehavior === 'restore' ? 'restore' : 'blank',
        autoSave: !!settings.autoSave,
        themeId: settings.themeId || 'indigo',
        editorPrefs: normalizeEditorPrefs(settings.editorPrefs),
        imageCompression: settings.imageCompression ?? true,
        fetchLinkTitle: settings.fetchLinkTitle ?? true,
        spellcheck: !!settings.spellcheck,
      });
      applyAppearance(settings.appearanceMode || 'light');
      setTheme(settings.themeId || 'indigo');
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const close = () => (isStandalone ? window.close() : onClose?.());

  const setAppearance = (mode: AppearanceMode) => {
    const next = { ...local, appearanceMode: mode };
    setLocal(next);
    applyAppearance(mode);
    window.api.app.previewSettings(next);
  };
  const setThemeId = (themeId: string) => {
    const next = { ...local, themeId };
    setLocal(next);
    setTheme(themeId);
    window.api.app.previewSettings(next);
  };
  // 排版改动实时预览；取消时 loadSettings 会从磁盘恢复
  const setPrefs = (patch: Partial<EditorPrefs>) => {
    const editorPrefs = normalizeEditorPrefs({ ...local.editorPrefs, ...patch });
    setLocal((s) => ({ ...s, editorPrefs }));
    applyEditorPrefs(editorPrefs);
  };
  const toggleRow = (key: 'imageCompression' | 'fetchLinkTitle' | 'spellcheck', icon: React.ReactNode, title: string, desc: string) => (
    <div className="settings-row">
      <div className="settings-row__label">
        {icon}
        <div>
          <div className="settings-row__title">{title}</div>
          <div className="settings-row__desc">{desc}</div>
        </div>
      </div>
      <label className={`toggle ${local[key] ? 'toggle--on' : ''}`}>
        <input type="checkbox" checked={local[key]} onChange={(e) => setLocal((s) => ({ ...s, [key]: e.target.checked }))} />
        <span className="toggle__track"><span className="toggle__thumb" /></span>
      </label>
    </div>
  );
  const handleClearSession = () => {
    if (window.confirm('这会清空上次的现场：打开着的标签页、还没保存的修改、最近打开的记录。磁盘上的文件不受影响。\n确认后窗口会立即重载，要继续吗？')) {
      // 会话只存在于主窗口，这里通知主窗口清空并重载
      window.api.app.clearSession();
      close();
    }
  };
  const handleSave = async () => {
    await window.api.app.saveSettings({ ...local });
    if (!isStandalone) await loadSettings();
    close();
  };
  const handleCancel = () => {
    if (isStandalone) window.api.app.revertSettings(); // 通知主窗口从磁盘恢复
    else loadSettings(); // 浮层就在主窗口里，直接从磁盘恢复
    close();
  };

  return (
    <div className={isStandalone ? 'standalone' : 'modal-backdrop'} onClick={isStandalone ? undefined : handleCancel}>
      {isStandalone && <div className="standalone-drag" />}
      <div className={isStandalone ? 'standalone-card' : 'modal-card modal-card--wide modal-card--flush'} onClick={(e) => e.stopPropagation()}>
        <header className={`modal-head ${isStandalone ? 'modal-head--standalone' : ''}`}>
          <h2 className="modal-title">设置</h2>
          {(!isStandalone || !isMac) && <button onClick={handleCancel} className="icon-btn" title="关闭"><X size={20} /></button>}
        </header>
        <div className={isStandalone ? 'standalone-scroll standalone-scroll--headed' : 'modal-body modal-body--headed'}>

          <div className="col gap-24">
            <section>
              <h3 className="settings-section-title">外观界面</h3>
              <div className="settings-card settings-card--grid">
                {APPEARANCE_OPTIONS.map((item) => (
                  <button key={item.id} onClick={() => setAppearance(item.id)} className={`appearance-btn ${local.appearanceMode === item.id ? 'appearance-btn--active' : ''}`}>
                    <item.icon size={18} />
                    <span className="text-sm fw-500">{item.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="settings-section-title"><Palette size={14} /> 品牌主题</h3>
              <div className="settings-card settings-card--grid2">
                {THEME_PRESETS.map((p) => {
                  const active = local.themeId === p.id;
                  return (
                    <button key={p.id} onClick={() => setThemeId(p.id)} className={`theme-btn ${active ? 'theme-btn--active' : ''}`}>
                      <div className="theme-btn__swatch" style={{ background: p.gradient, boxShadow: active ? `0 0 10px ${p.shadow}` : 'none' }} />
                      <span className={`text-sm ${active ? 'fw-600' : ''}`}>{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="settings-section-title"><Type size={14} /> 正文排版</h3>
              <div className="settings-card">
                <div className="settings-row">
                  <div>
                    <div className="settings-row__title">正文字体</div>
                    <div className="settings-row__desc">富文本与预览的正文；代码始终用等宽字体</div>
                  </div>
                  <select className="settings-select" value={local.editorPrefs.font} onChange={(e) => setPrefs({ font: e.target.value as EditorPrefs['font'] })}>
                    {(Object.keys(EDITOR_FONTS) as EditorPrefs['font'][]).map((id) => <option key={id} value={id}>{EDITOR_FONTS[id].label}</option>)}
                  </select>
                </div>
                <div className="settings-divider" />
                <div className="settings-row">
                  <div><div className="settings-row__title">字号</div></div>
                  <div className="settings-range">
                    <input type="range" min={13} max={22} step={1} value={local.editorPrefs.fontSize} onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })} />
                    <span className="settings-range__value">{local.editorPrefs.fontSize}px</span>
                  </div>
                </div>
                <div className="settings-divider" />
                <div className="settings-row">
                  <div><div className="settings-row__title">行距</div></div>
                  <div className="settings-range">
                    <input type="range" min={1.3} max={2.4} step={0.1} value={local.editorPrefs.lineHeight} onChange={(e) => setPrefs({ lineHeight: Number(e.target.value) })} />
                    <span className="settings-range__value">{local.editorPrefs.lineHeight.toFixed(1)}</span>
                  </div>
                </div>
                <div className="settings-divider" />
                <div className="settings-row">
                  <div><div className="settings-row__title">页面宽度</div></div>
                  <div className="seg-switch">
                    {(Object.keys(PAGE_WIDTHS) as EditorPrefs['pageWidth'][]).map((id) => (
                      <button key={id} onClick={() => setPrefs({ pageWidth: id })} className={`seg-switch__btn ${local.editorPrefs.pageWidth === id ? 'seg-switch__btn--active' : ''}`}>{PAGE_WIDTHS[id].label}</button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h3 className="settings-section-title">粘贴与输入</h3>
              <div className="settings-card">
                {toggleRow('imageCompression', <ImageDown size={18} color="var(--text-muted)" />, '粘贴图片时压缩', '截图等大图转成 WebP 再存进文档旁的 assets/，体积通常小一半以上；动图、矢量图不动')}
                <div className="settings-divider" />
                {toggleRow('fetchLinkTitle', <Link2 size={18} color="var(--text-muted)" />, '粘贴网址时取网页标题', '贴进来的只是一个网址时，访问它一次取标题，变成 [标题](网址)')}
                <div className="settings-divider" />
                {toggleRow('spellcheck', <SpellCheck size={18} color="var(--text-muted)" />, '拼写检查', '用系统词典给拼错的英文单词标红；中文文档建议关闭')}
              </div>
            </section>

            <section>
              <h3 className="settings-section-title">常规选项</h3>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row__label">
                    <Power size={18} color="var(--text-muted)" />
                    <div>
                      <div className="settings-row__title">启动时</div>
                      <div className="settings-row__desc">接着上次的标签页继续，或者每次都从一篇空白文档开始</div>
                    </div>
                  </div>
                  <div className="seg-switch">
                    <button onClick={() => setLocal((s) => ({ ...s, startupBehavior: 'restore' }))} className={`seg-switch__btn ${local.startupBehavior === 'restore' ? 'seg-switch__btn--active' : ''}`}>恢复上次的标签页</button>
                    <button onClick={() => setLocal((s) => ({ ...s, startupBehavior: 'blank' }))} className={`seg-switch__btn ${local.startupBehavior === 'blank' ? 'seg-switch__btn--active' : ''}`}>空白文档</button>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-row">
                  <div className="settings-row__label">
                    <Save size={18} color="var(--text-muted)" />
                    <div>
                      <div className="settings-row__title">自动保存</div>
                      <div className="settings-row__desc">点到编辑器外面时，把改过的文件存盘。未命名文档不会被悄悄建成文件；没保存的内容重启后也还在</div>
                    </div>
                  </div>
                  <label className={`toggle ${local.autoSave ? 'toggle--on' : ''}`}>
                    <input type="checkbox" checked={local.autoSave} onChange={(e) => setLocal((s) => ({ ...s, autoSave: e.target.checked }))} />
                    <span className="toggle__track"><span className="toggle__thumb" /></span>
                  </label>
                </div>
              </div>
            </section>

            <section>
              <h3 className="settings-section-title settings-section-title--danger"><AlertTriangle size={14} /> 出了问题时</h3>
              <div className="settings-card settings-card--danger">
                <div>
                  <div className="settings-row__title settings-row__title--danger">清空上次的现场</div>
                  <div className="settings-row__desc">标签页、没保存的修改、最近打开的记录一并清掉，窗口重载。磁盘上的文件不动。</div>
                </div>
                <button onClick={handleClearSession} className="btn btn-danger"><Trash2 size={14} /> 清空</button>
              </div>
            </section>
          </div>
        </div>

        <div className={isStandalone ? 'standalone-footer' : 'modal-footer'}>
          <button onClick={handleSave} className="btn btn-primary btn-block">保存</button>
          <button onClick={handleCancel} className="btn btn-secondary btn-wide">取消</button>
        </div>
      </div>
    </div>
  );
};
