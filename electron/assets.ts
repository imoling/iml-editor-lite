import { protocol, net } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { Readable } from 'stream';
import { extractHtmlTitle, detectCharset } from './shared/pageTitle';

/** 笔记里会出现的图片类型；iml-asset:// 只放行图片和音频的扩展名，避免笔记里的一条地址就能读任意本地文件 */
export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/i;
/** 笔记里会出现的音频：实时转写留下的录音（.webm），以及用户自己放进来的 */
export const AUDIO_EXT_RE = /\.(webm|m4a|mp3|wav|ogg|oga|opus|aac|flac)$/i;
/** 笔记里嵌入的视频（`![[演示.mp4]]`）。.webm 归在音频里——转写留下的录音就是它；真是视频的 .webm 也能放，只是没有画面 */
export const VIDEO_EXT_RE = /\.(mp4|m4v|mov|ogv)$/i;
const VIDEO_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.ogv': 'video/ogg' };
const AUDIO_MIME: Record<string, string> = { '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac' };
const NOTE_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
/** 也可能引用图片的文本类文件（白板、导出的网页等）：扫描孤儿图片时一并当作「引用来源」 */
const TEXT_REF_RE = /\.(md|markdown|mdown|mkd|txt|html?|canvas|json|excalidraw|css|org|tex)$/i;
const MAX_TEXT_SIZE = 4 * 1024 * 1024;

export const ASSET_SCHEME = 'iml-asset';

/** 必须在 app ready 之前调用 */
export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** bytes=START-END / bytes=START- / bytes=-SUFFIX → 闭区间 [start, end]；不合法或超出文件返回 null（回 416） */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * 音频要能拖动进度，播放器会发 Range 请求，必须老老实实回 206 + Content-Range；
 * 交给 net.fetch(file://) 的话状态码和分段都不可控，拖一下进度就回到开头
 */
async function serveMedia(filePath: string, request: Request): Promise<Response> {
  const { size } = await fs.promises.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = AUDIO_MIME[ext] || VIDEO_MIME[ext] || 'application/octet-stream';
  const rangeHeader = request.headers.get('range');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (!rangeHeader) {
    return new Response(Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  const range = parseRange(rangeHeader, size);
  if (!range) return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(filePath, range)) as unknown as ReadableStream, {
    status: 206,
    headers: { ...base, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` },
  });
}

/** iml-asset://local/<encodeURIComponent(绝对路径)> → 本地的图片或音频文件 */
export function handleAssetProtocol() {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = path.normalize(decodeURIComponent(url.pathname.replace(/^\//, '')));
      if (!path.isAbsolute(filePath)) return new Response('forbidden', { status: 403 });
      if (AUDIO_EXT_RE.test(filePath) || VIDEO_EXT_RE.test(filePath)) return await serveMedia(filePath, request);
      if (!IMAGE_EXT_RE.test(filePath)) return new Response('forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// 粘贴图片的文件名：纯函数，在 shared/assetNames.ts（Tauri 壳的前端适配层也用）
export { assetFileName } from './shared/assetNames';

// ── 未引用图片扫描 ───────────────────────────────────────────────────────────

export interface OrphanImage {
  path: string;
  /** 相对笔记库根目录的路径（展示用） */
  relative: string;
  size: number;
  mtime: number;
}

async function walk(dir: string, onFile: (full: string, stat: fs.Stats) => Promise<void> | void) {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, onFile);
    else if (entry.isFile()) {
      try { await onFile(full, await fs.promises.stat(full)); } catch { /* 读不了就跳过 */ }
    }
  }
}

/** 文件名可能以这些形式出现在引用里：原样、URI 编码、NFC / NFD（macOS 文件系统偏好 NFD） */
export function nameVariants(name: string): string[] {
  const forms = new Set<string>();
  for (const n of [name, name.normalize('NFC'), name.normalize('NFD')]) {
    forms.add(n);
    try { forms.add(encodeURI(n)); } catch { /* ignore */ }
    try { forms.add(encodeURIComponent(n)); } catch { /* ignore */ }
    forms.add(n.replace(/ /g, '%20'));
  }
  return [...forms].map((f) => f.toLowerCase());
}

/**
 * 找出笔记库里没有任何笔记引用的图片。判定偏保守：只要图片的文件名（任一写法）出现在任何文本文件里，就算被引用 ——
 * 宁可漏删，不能误删。extraTexts 传入尚未保存的标签页内容，刚粘贴还没落盘的图片不会被误判。
 */
export async function findOrphanImages(root: string, extraTexts: string[] = []): Promise<OrphanImage[]> {
  const images: OrphanImage[] = [];
  const texts: string[] = extraTexts.map((t) => t.toLowerCase());
  await walk(root, async (full, stat) => {
    if (IMAGE_EXT_RE.test(full)) {
      images.push({ path: full, relative: path.relative(root, full), size: stat.size, mtime: stat.mtimeMs });
    } else if (TEXT_REF_RE.test(full) && stat.size <= MAX_TEXT_SIZE) {
      texts.push((await fs.promises.readFile(full, 'utf8')).toLowerCase());
    }
  });
  const haystack = texts.join('\n');
  return images
    .filter((img) => !nameVariants(path.basename(img.path)).some((v) => haystack.includes(v)))
    .sort((a, b) => a.relative.localeCompare(b.relative));
}

/** 只允许删笔记库里的图片文件；返回真正要处理的路径 */
export function filterTrashable(root: string, paths: string[]): string[] {
  const base = path.resolve(root) + path.sep;
  return paths.map((p) => path.resolve(p)).filter((p) => p.startsWith(base) && IMAGE_EXT_RE.test(p) && !NOTE_RE.test(p));
}

// ── 网页标题 ─────────────────────────────────────────────────────────────────

// 网页标题的解析：纯函数，在 shared/pageTitle.ts
export { extractHtmlTitle, detectCharset } from './shared/pageTitle';

/** 取一张网上的图片（导出长图要把图片内联进去）：只认 http(s)，15 秒超时，最多 12MB，回来的得是图片；任何失败都返回 null */
export async function fetchImageBytes(target: string): Promise<Uint8Array | null> {
  let url: URL;
  try { url = new URL(target); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { Accept: 'image/*,*/*;q=0.5' } });
    const type = resp.headers.get('content-type') || '';
    if (!resp.ok || (type && !/^(image\/|application\/octet-stream)/i.test(type))) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return bytes.byteLength > 12 * 1024 * 1024 ? null : bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 抓网页标题：只认 http(s)，5 秒超时，最多读 512KB；任何失败都返回 null（调用方保留原链接即可） */
export async function fetchPageTitle(target: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(target); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const type = resp.headers.get('content-type') || '';
    if (!resp.ok || !resp.body || (type && !/html|xml/i.test(type))) return null;
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 512 * 1024) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
      // 标题通常在最前面几 KB，读到 </title> 就不必再下了
      if (/<\/title>/i.test(Buffer.from(value).toString('latin1'))) break;
    }
    reader.cancel().catch(() => {});
    const buf = Buffer.concat(chunks);
    const charset = detectCharset(type, buf.subarray(0, 4096).toString('latin1'));
    let html: string;
    try { html = new TextDecoder(charset).decode(buf); } catch { html = buf.toString('utf8'); }
    return extractHtmlTitle(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
