import { protocol, net } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/** 笔记里会出现的图片类型；iml-asset:// 只放行这些扩展名，避免笔记里的一条地址就能读任意本地文件 */
export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/i;
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

/** iml-asset://local/<encodeURIComponent(绝对路径)> → 本地图片文件 */
export function handleAssetProtocol() {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = path.normalize(decodeURIComponent(url.pathname.replace(/^\//, '')));
      if (!path.isAbsolute(filePath) || !IMAGE_EXT_RE.test(filePath)) return new Response('forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ── 粘贴图片的文件名 ─────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 剪贴板里的截图统一叫 image.png，拖进来的文件名可能带空格（Markdown 地址里要转义）。
 * 这里给出落盘用的名字：通用名换成时间戳，空白换成 -，去掉路径非法字符。
 */
export function assetFileName(original: string, now = new Date()): string {
  const ext = (path.extname(original) || '.png').toLowerCase();
  let base = path.basename(original, path.extname(original)).trim();
  if (!base || /^(image|img|untitled|blob|截屏|屏幕截图|screenshot|pasted[ -_]?image)$/i.test(base)) {
    base = `img-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
  base = base.replace(/[\\/:*?"<>|#%()[\]]/g, '').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'img';
  return `${base.slice(0, 80)}${ext}`;
}

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

const decodeEntities = (s: string) =>
  s.replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

/** 从 HTML 里取标题：<title> 优先，其次 og:title */
export function extractHtmlTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    ?? /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1]
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  if (!title) return null;
  const clean = decodeEntities(title).replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 140) : null;
}

/** Content-Type 或 <meta charset> 里声明的编码（不少中文站还是 GBK） */
export function detectCharset(contentType: string, head: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const name = (fromHeader || fromMeta || 'utf-8').toLowerCase();
  return name === 'gb2312' ? 'gbk' : name;
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
