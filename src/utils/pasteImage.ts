import { useAppStore } from '../stores/appStore';
import { imageOwnerPath } from './currentNoteDir';

/** 压缩后的最长边：Retina 全屏截图是 2880 甚至 5K，笔记里用不着 */
const MAX_WIDTH = 2560;
const MAX_HEIGHT = 12000;
const MIN_BYTES_TO_COMPRESS = 150 * 1024;
const WEBP_QUALITY = 0.9;
/** 动图、矢量图、已经是高压缩格式的不动 */
const SKIP_TYPES = /^image\/(gif|svg\+xml|webp|avif)$/i;

export interface PreparedImage {
  buffer: ArrayBuffer;
  name: string;
  originalBytes: number;
  bytes: number;
  compressed: boolean;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 目标尺寸：等比缩到上限以内，不放大 */
export function fitSize(width: number, height: number, maxWidth = MAX_WIDTH, maxHeight = MAX_HEIGHT) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 截图类的大 PNG 压成 WebP（质量 0.9，文字边缘比同体积的 JPEG 干净得多，保留透明通道）。
 * 压完没小多少（< 10%）就用原图；任何一步失败也用原图 —— 压缩是锦上添花，不能让粘贴失败。
 */
export async function prepareImage(file: File, compress: boolean): Promise<PreparedImage> {
  const original = await file.arrayBuffer();
  const keep: PreparedImage = { buffer: original, name: file.name || 'image.png', originalBytes: original.byteLength, bytes: original.byteLength, compressed: false };
  if (!compress || SKIP_TYPES.test(file.type) || original.byteLength < MIN_BYTES_TO_COMPRESS) return keep;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return keep;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
    if (!blob || blob.type !== 'image/webp' || blob.size > original.byteLength * 0.9) return keep;
    const base = (file.name || 'image.png').replace(/\.[^.]+$/, '') || 'image';
    return { buffer: await blob.arrayBuffer(), name: `${base}.webp`, originalBytes: original.byteLength, bytes: blob.size, compressed: true };
  } catch (err) {
    console.warn('[pasteImage] compress failed, keeping original:', err);
    return keep;
  }
}

/** 粘贴 / 拖入的图片：按设置压缩 → 存到笔记旁的 assets/ → 返回 Markdown 里用的相对路径 */
export async function storeImageFile(file: File, tabId: string | null): Promise<string | null> {
  const owner = imageOwnerPath(tabId);
  if (!owner) return null;
  const { imageCompression, notify } = useAppStore.getState();
  const prepared = await prepareImage(file, imageCompression);
  const result = await window.api.fs.saveImage(owner, prepared.name, prepared.buffer);
  if (!result.success || !result.path) {
    notify(`图片保存失败：${result.error || '未知错误'}`);
    return null;
  }
  if (prepared.compressed) notify(`图片已压缩 ${formatBytes(prepared.originalBytes)} → ${formatBytes(prepared.bytes)}`);
  return result.path;
}

/**
 * data URL（本地上传 / AI 生成的图片）→ 存成笔记旁的文件，返回相对路径。
 * 存不了（比如还没有笔记库目录）就把 data URL 原样还回去，插入照常进行。
 */
export async function persistDataUrl(dataUrl: string, tabId: string | null, nameHint = 'image'): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    // 不用 fetch(dataUrl)：页面的 CSP 只放行了 connect-src 'self'，data: 会被拦
    const m = /^data:([^;,]+)((?:;[^;,]+)*?)(;base64)?,([\s\S]*)$/.exec(dataUrl);
    if (!m) return dataUrl;
    const binary = m[3] ? atob(m[4]) : decodeURIComponent(m[4]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: m[1] });
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const base = nameHint.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'image';
    const stored = await storeImageFile(new File([blob], `${base}.${ext}`, { type: blob.type }), tabId);
    return stored || dataUrl;
  } catch (err) {
    console.warn('[pasteImage] persistDataUrl failed:', err);
    return dataUrl;
  }
}
