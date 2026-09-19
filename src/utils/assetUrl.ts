/**
 * 笔记里的图片地址 → 编辑器里真正能加载的地址。
 * 页面本身来自 app 包（file://…/dist 或 dev server），`assets/a.png` 这种相对路径如果直接交给 <img>，
 * 会相对应用自己去找，永远找不到。这里按「笔记所在目录」解析，并走主进程注册的 iml-asset:// 协议读本地文件。
 */

const ASSET_SCHEME = 'iml-asset://local/';

const isWindowsAbs = (p: string) => /^[A-Za-z]:[\\/]/.test(p);

function safeDecode(s: string): string {
  try { return decodeURI(s); } catch { return s; }
}

/** 目录 + 相对路径，处理 . 和 ..；分隔符跟随目录 */
export function joinNotePath(dir: string, rel: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const parts = dir.split(/[\\/]/);
  for (const seg of rel.split(/[\\/]/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (parts.length > 1) parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join(sep);
}

export function toAssetUrl(absPath: string): string {
  return ASSET_SCHEME + encodeURIComponent(absPath);
}

/** noteDir 为空（还没有落盘位置）时相对路径原样返回 */
export function resolveAssetUrl(src: string, noteDir: string | null): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:|iml-asset:)/i.test(src)) return src;
  if (/^file:\/\//i.test(src)) {
    let p = safeDecode(src.replace(/^file:\/\//i, ''));
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    return toAssetUrl(p);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !isWindowsAbs(src)) return src; // 其他协议不碰
  const clean = safeDecode(src.split(/[?#]/)[0]);
  if (clean.startsWith('/') || isWindowsAbs(clean)) return toAssetUrl(clean);
  if (!noteDir) return src;
  return toAssetUrl(joinNotePath(noteDir, clean));
}

/** 标签页 id（文件路径或 new-xxx）→ 它的图片该相对哪个目录解析 */
export function noteDirOf(tabId: string | null, fallbackDir: string): string | null {
  if (!tabId || tabId.startsWith('new-')) return fallbackDir || null;
  const idx = Math.max(tabId.lastIndexOf('/'), tabId.lastIndexOf('\\'));
  return idx > 0 ? tabId.slice(0, idx) : null;
}

/** 把一段 HTML 里图片和音频（转写留下的录音）的地址换成可加载的（预览、原样保留块用） */
export function resolveImagesInHtml(html: string, noteDir: string | null): string {
  if (!/<(?:img|audio|source)\b/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img[src], audio[src], audio > source[src]').forEach((el) => {
    el.setAttribute('src', resolveAssetUrl(el.getAttribute('src') || '', noteDir));
  });
  return doc.body.innerHTML;
}
