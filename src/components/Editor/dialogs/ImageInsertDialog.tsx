import React from 'react';

interface ImageInsertDialogProps {
  onConfirm: (src: string, alt: string) => void;
  onCancel: () => void;
}

type Tab = 'upload' | 'url';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upload', label: '本地上传' },
  { id: 'url', label: '网络链接' },
];

/** 系统剪贴板里的图片：先问壳（两边的壳都读得到），没有壳的接口再试浏览器的剪贴板 API */
async function readClipboardImage(): Promise<File | null> {
  const bytes = await window.api.clipboard?.readImage?.();
  if (bytes) return new File([new Uint8Array(bytes)], 'clipboard.png', { type: 'image/png' });
  if (window.api.clipboard) return null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const ext = type.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      return new File([blob], `clipboard.${ext}`, { type });
    }
  } catch {
    // 没权限或不支持：当作剪贴板里没有图片
  }
  return null;
}

/** 插入图片：本地上传 / 网络链接 */
export const ImageInsertDialog: React.FC<ImageInsertDialogProps> = ({ onConfirm, onCancel }) => {
  const [tab, setTab] = React.useState<Tab>('upload');
  const [url, setUrl] = React.useState('');
  const [alt, setAlt] = React.useState('');
  const [preview, setPreview] = React.useState('');
  const [dragging, setDragging] = React.useState(false);
  const [clipboardNote, setClipboardNote] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  /** 选中 / 拖入 / 从剪贴板读到的图：读成 data URL 预览；有文件名的顺手填进描述，剪贴板来的没有像样的名字就不填 */
  const handleFile = (file: File, nameAsAlt = true) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
      if (nameAsAlt && !alt) setAlt(file.name.replace(/\.[^.]+$/, ''));
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleClipboard = async () => {
    setClipboardNote('');
    const file = await readClipboardImage();
    if (file) handleFile(file, false);
    else setClipboardNote('剪贴板里没有图片');
  };

  const canConfirm = tab === 'upload' ? !!preview : !!url.trim();

  const handleConfirm = () => {
    if (!canConfirm) return;
    if (tab === 'upload') onConfirm(preview, alt.trim());
    else onConfirm(url.trim(), alt.trim());
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canConfirm) handleConfirm();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="modal-backdrop modal-backdrop--light" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-card image-dialog">
        <div className="image-dialog__head">
          <h3 className="modal-title modal-title--sm">插入图片</h3>
          <div className="segmented">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`segmented__btn ${tab === t.id ? 'segmented__btn--active' : ''}`}>{t.label}</button>
            ))}
          </div>
        </div>

        <div className="image-dialog__body">
          {tab === 'upload' && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`dropzone ${dragging ? 'dropzone--active' : ''}`}
              >
                {preview ? (
                  <img src={preview} alt="preview" className="dropzone__preview" />
                ) : (
                  <div className="dropzone__hint">
                    <div className="dropzone__icon">🖼️</div>
                    <div className="text-md text-secondary fw-500">点击选择或拖拽图片到此处</div>
                    <div className="text-xs text-muted mt-4">支持 JPG、PNG、GIF、WebP</div>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <div className="row gap-10 image-dialog__clipboard">
                <button type="button" onClick={handleClipboard} className="btn btn-ghost btn-sm">从剪贴板读取</button>
                {clipboardNote && <span className="text-xs text-muted">{clipboardNote}</span>}
              </div>
            </>
          )}

          {tab === 'url' && (
            <div className="col gap-8">
              <label className="text-sm text-secondary fw-500">图片 URL</label>
              <input autoFocus type="url" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onInputKey} placeholder="https://example.com/image.jpg" className="field-input field-input--xs" />
              {url.trim() && (
                <div className="image-dialog__url-preview">
                  <img src={url.trim()} alt="preview" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
              )}
            </div>
          )}

          <div className="col gap-6">
            <label className="text-sm text-secondary fw-500">图片描述 <span className="text-muted fw-400">(可选)</span></label>
            <input type="text" value={alt} onChange={(e) => setAlt(e.target.value)} onKeyDown={onInputKey} placeholder="图片说明文字" className="field-input field-input--xs" />
          </div>

          <div className="row gap-10 mt-2">
            <button onClick={onCancel} className="btn btn-ghost btn-sm btn-block">取消</button>
            <button onClick={handleConfirm} disabled={!canConfirm} className="btn btn-primary btn-sm btn-block">插入</button>
          </div>
        </div>
      </div>

    </div>
  );
};
