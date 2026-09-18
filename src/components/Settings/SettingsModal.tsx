import React, { useState, useEffect } from 'react';
import { X, Moon, Sun, Monitor, Palette, Power, Save, Trash2, AlertTriangle, FolderOpen, Coffee, Type, ImageDown, Link2, SpellCheck, ShieldCheck, ImageOff } from 'lucide-react';
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
  const { setTheme, applyAppearance, loadSettings, openDialog } = useAppStore();
  const isOpen = isStandalone || !!onClose;

  const [local, setLocal] = useState({
    appearanceMode: 'light' as string,
    startupBehavior: 'restore' as string,
    autoSave: true,
    defaultLibraryPath: '',
    themeId: 'indigo',
    editorPrefs: DEFAULT_EDITOR_PREFS as EditorPrefs,
    imageCompression: true,
    fetchLinkTitle: true,
    spellcheck: false,
    aiEnabled: true,
  });

  // 从磁盘加载并预览
  useEffect(() => {
    if (!isOpen) return;
    window.api.app.getSettings().then((settings: any) => {
      if (!settings) return;
      setLocal({
        appearanceMode: settings.appearanceMode || 'light',
        startupBehavior: settings.startupBehavior || 'restore',
        autoSave: settings.autoSave ?? true,
        defaultLibraryPath: settings.defaultLibraryPath || '',
        themeId: settings.themeId || 'indigo',
        editorPrefs: normalizeEditorPrefs(settings.editorPrefs),
        imageCompression: settings.imageCompression ?? true,
        fetchLinkTitle: settings.fetchLinkTitle ?? true,
        spellcheck: !!settings.spellcheck,
        aiEnabled: settings.aiEnabled ?? true,
      });
      applyAppearance(settings.appearanceMode || 'light');
      setTheme(settings.themeId || 'indigo');
    });
  }, [isOpen]);

  // 把笔记库放进 iCloud Drive（为 iPad 端同步做准备）；没有 iCloud Drive 时按钮不显示
  const [icloudPath, setIcloudPath] = useState<string | null>(null);
  useEffect(() => {
    window.api.app.getICloudLibraryPath().then(setIcloudPath).catch(() => setIcloudPath(null));
  }, []);

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
  const toggleRow = (key: 'imageCompression' | 'fetchLinkTitle' | 'spellcheck' | 'aiEnabled', icon: React.ReactNode, title: string, desc: string) => (
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
  const handleSelectLibrary = async () => {
    const result = await window.api.dialog.open({ properties: ['openDirectory'] });
    if (result && result.length > 0) setLocal((s) => ({ ...s, defaultLibraryPath: result[0] }));
  };
  const handleClearSession = () => {
    if (window.confirm('警告：此操作将彻底抹除当前一切会话现场（包括您的星标状态与记忆目录）。\n点击确认后主窗口将会立即重载。确定要继续吗？')) {
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
          <h2 className="modal-title">全局设置</h2>
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
                {toggleRow('imageCompression', <ImageDown size={18} color="var(--text-muted)" />, '粘贴图片时压缩', '截图等大图转成 WebP 再存进笔记旁的 assets/，体积通常小一半以上；动图、矢量图不动')}
                <div className="settings-divider" />
                {toggleRow('fetchLinkTitle', <Link2 size={18} color="var(--text-muted)" />, '粘贴网址时取网页标题', '贴进来的只是一个网址时，访问它一次取标题，变成 [标题](网址)')}
                <div className="settings-divider" />
                {toggleRow('spellcheck', <SpellCheck size={18} color="var(--text-muted)" />, '拼写检查', '用系统词典给拼错的英文单词标红；中文笔记建议关闭')}
              </div>
            </section>

            <section>
              <h3 className="settings-section-title"><ShieldCheck size={14} /> AI 与隐私</h3>
              <div className="settings-card">
                {toggleRow('aiEnabled', <ShieldCheck size={18} color="var(--text-muted)" />, '启用 AI 功能', '关闭后所有 AI 入口隐藏（写作助手、AI 配图、相关笔记、语义搜索），应用不向任何模型服务发请求')}
                <div className="hint">状态栏右侧始终显示 AI 请求发往哪里：本机（不出这台电脑）还是云端服务。</div>
              </div>
            </section>

            <section>
              <h3 className="settings-section-title">常规选项</h3>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row__label">
                    <Power size={18} color="var(--text-muted)" />
                    <div>
                      <div className="settings-row__title">启动行为</div>
                      <div className="settings-row__desc">每次打开知识库时呈现的画面</div>
                    </div>
                  </div>
                  <div className="seg-switch">
                    <button onClick={() => setLocal((s) => ({ ...s, startupBehavior: 'restore' }))} className={`seg-switch__btn ${local.startupBehavior === 'restore' ? 'seg-switch__btn--active' : ''}`}>恢复上次会话</button>
                    <button onClick={() => setLocal((s) => ({ ...s, startupBehavior: 'dashboard' }))} className={`seg-switch__btn ${local.startupBehavior === 'dashboard' ? 'seg-switch__btn--active' : ''}`}>起始控制台</button>
                  </div>
                </div>

                <div className="settings-divider" />

                <div className="settings-row">
                  <div className="settings-row__label">
                    <Save size={18} color="var(--text-muted)" />
                    <div>
                      <div className="settings-row__title">静默自动保存</div>
                      <div className="settings-row__desc">编辑器失焦时无感存盘；未命名文档会自动存入笔记库</div>
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
              <h3 className="settings-section-title">笔记库</h3>
              <div className="settings-card gap-10">
                <div className="settings-row">
                  <div>
                    <div className="settings-row__title">笔记库位置</div>
                    <div className="settings-row__desc">侧边栏的树根；新建与静默保存的笔记都放在这里</div>
                  </div>
                  <div className="row gap-10">
                    {icloudPath && (
                      <button onClick={() => setLocal((s) => ({ ...s, defaultLibraryPath: icloudPath }))} title={icloudPath} className="btn-link">☁︎ 使用 iCloud Drive</button>
                    )}
                    <button onClick={handleSelectLibrary} className="btn-link"><FolderOpen size={12} /> 更改目录</button>
                  </div>
                </div>
                <div className="path-box">{local.defaultLibraryPath || '未设置'}</div>
                <div className="hint">放在 iCloud Drive 或其他同步盘目录里即可多设备共用；外部改动会自动刷新，未保存的标签页会用橙点提示。</div>
                {!isStandalone && (
                  <>
                    <div className="settings-divider" />
                    <div className="settings-row">
                      <div>
                        <div className="settings-row__title">清理未引用的图片</div>
                        <div className="settings-row__desc">找出没有任何笔记用到的图片，确认后移入废纸篓</div>
                      </div>
                      <button onClick={() => { handleCancel(); openDialog('image-cleanup'); }} className="btn-link"><ImageOff size={12} /> 开始扫描</button>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section>
              <h3 className="settings-section-title settings-section-title--danger"><AlertTriangle size={14} /> 安全逃生舱</h3>
              <div className="settings-card settings-card--danger">
                <div>
                  <div className="settings-row__title settings-row__title--danger">销毁本地记忆快照</div>
                  <div className="settings-row__desc">一键抹除全部现场，并让应用浴火重生。</div>
                </div>
                <button onClick={handleClearSession} className="btn btn-danger"><Trash2 size={14} /> 清除全部</button>
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
