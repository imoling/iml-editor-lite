/**
 * 导出长图（PNG）：发群里、发朋友圈用。
 *
 * 不靠外壳截屏（Tauri 的系统 WebView 没有那个接口），全在页面里完成：把导出用的 HTML 包进 SVG 的 <foreignObject>，
 * 当成一张图片画到画布上。Electron 壳和 Tauri 壳走的是同一份代码，出来的图一样。
 *
 * 四条硬约束决定了下面的写法：
 * ① SVG 当图片用时不会去加载任何外部资源 → 公式要用的 KaTeX 样式和字体得内联进去；
 * ② SVG 里内嵌的图片，Safari 内核不保证在第一次绘制前解码完（时有时无地缺图）→ 图片不放进 SVG，
 *    SVG 里只留同样大小的空位，图片由这边按量好的位置直接画到画布上；
 * ③ 画布有大小上限，太长的文档得分成几张 → 在段落 / 列表项 / 表格行的底边切，别把一行字切成两半；
 * ④ 一次光栅化太高的 SVG 很吃内存 → 每张图再按 4000 个 CSS 像素一段一段画上去。
 */
import { exportCss } from '../../electron/shared/exportDoc';
import { planRanges, planTiles, maxImageHeight, type Range } from '../../electron/shared/imageTiles';
import { BRAND_CSS, brandFooterHtml, brandBand } from '../../electron/shared/imageBrand';
import { resolveAssetUrl } from './assetUrl';
// 角标的小图标只有几 KB，构建时内联成 data: 地址
import logoData from '../assets/logo-64.png?inline';

// KaTeX 的字体不内联进 JS：界面渲染公式本来就要带一份 woff2，再内联一份 base64 等于安装包白背二百多 KB。
// 这里只记下包里那一份的地址，导出时才去读（见 readBundledFile）
const katexFonts = import.meta.glob('/node_modules/katex/dist/fonts/*.woff2', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** KaTeX 样式表里的字体地址（开发时是原文件名，打包后带哈希）→ 包里那一份字体的键 */
export function katexFontKey(url: string, keys: string[]): string | null {
  const name = /KaTeX_[A-Za-z0-9]+-[A-Za-z]+/.exec(url)?.[0];
  return (name && keys.find((k) => k.endsWith(`/${name}.woff2`))) || null;
}

/** 固定成手机上好读的宽度；2 倍清晰度，成品 1500 像素宽，和屏幕无关 */
export const IMAGE_CSS_WIDTH = 750;
export const IMAGE_SCALE = 2;
const TILE_HEIGHT = 4000;
/** 第二张起，开头补一段和第一张页顶一样的留白，不然正文顶着图的上边 */
const TOP_PAD = 40;
const MAX_REMOTE_IMAGE = 12 * 1024 * 1024;
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * 把应用包里的一个文件读成 data: 地址。先用 fetch；Electron 正式包的页面来自 file://，那里 fetch 不认这个协议，
 * 退回 XMLHttpRequest（file:// 下状态码是 0）。都读不到就返回 null，由调用的地方决定怎么凑合
 */
export async function readBundledFile(url: string, type: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  let bytes: ArrayBuffer | null = null;
  try {
    const res = await fetch(url);
    if (res.ok) bytes = await res.arrayBuffer();
  } catch { /* 换下面那条路 */ }
  if (!bytes) {
    bytes = await new Promise<ArrayBuffer | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => resolve((xhr.status === 200 || xhr.status === 0) && xhr.response ? (xhr.response as ArrayBuffer) : null);
      xhr.onerror = () => resolve(null);
      xhr.send();
    });
  }
  return bytes && bytes.byteLength ? toDataUrl(new Blob([bytes], { type })) : null;
}

/**
 * 导出的内容里有公式时要带上的 KaTeX 样式。导出用的 HTML 经过净化后只剩 KaTeX 的 HTML 结构（MathML 被去掉了），
 * 没有这份样式，分数、上下标全都摊成一行字。
 * withFonts：离开应用也要能看的（长图里的 SVG、单文件 HTML）把字体也内联进去；还在应用页面里的（打印 / 存 PDF）
 * 用界面已经加载的同名字体就行，不必再背三百 KB。拿不到就返回空串——公式难看一点，总比导出失败强
 */
export async function katexStyles(withFonts: boolean): Promise<string> {
  try {
    const raw = (await import('katex/dist/katex.min.css?inline')).default as string;
    if (!withFonts) return raw;
    return await inlineFontFaces(raw, async (url) => { const key = katexFontKey(url, Object.keys(katexFonts)); return key ? readBundledFile(katexFonts[key], 'font/woff2') : null; });
  } catch (err) {
    console.warn('[export] KaTeX styles unavailable:', err);
    return '';
  }
}

/** 一张图在文档里的位置（CSS 像素，相对正文顶端）和圆角：由这边直接画到画布上 */
interface ImageBox { image: HTMLImageElement; left: number; top: number; width: number; height: number; radius: number }

/** 长图用的样式：导出的那一套，正文容器换成固定宽度、四周留白。extra 是文档里有公式时才带上的 KaTeX 样式 */
export function longImageCss(extra = ''): string {
  return `${extra}${exportCss('.export-body')}
  .export-body { width: ${IMAGE_CSS_WIDTH}px; max-width: none; margin: 0; box-sizing: border-box; padding: 40px 44px 48px; background: #fff; }
  ${BRAND_CSS}`;
}

/**
 * KaTeX 样式表里的 @font-face：每种字体列了 woff2 / woff / ttf 三个地址，只留 woff2，并换成 load 给回来的 data: 地址。
 * 取不到的字体整条去掉（那几个字形退回系统字体，总比整张图出不来强）
 */
export async function inlineFontFaces(css: string, load: (url: string) => Promise<string | null>): Promise<string> {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  const replaced = await Promise.all(faces.map(async (face) => {
    // 很小的字体（不到 4 KB）打包时已经被内联成 data: 地址了，直接用那一份；
    // 下面换 src 的时候 url(...) 要整个认：data: 地址里自己带分号（;base64），不能在那儿断开
    const inlined = /url\(\s*["']?(data:font\/woff2[^"')]+)["']?\s*\)/i.exec(face)?.[1];
    const url = /url\(\s*["']?([^"')]+\.woff2[^"')]*)["']?\s*\)/i.exec(face)?.[1];
    const data = inlined || (url ? await load(url) : null);
    return data ? face.replace(/src\s*:(?:url\([^)]*\)|[^;}])*/i, `src:url(${data}) format("woff2")`) : '';
  }));
  return faces.reduce((out, face, i) => out.replace(face, replaced[i]), css);
}

/** 按文件头认图片格式（取回来的远程图片、本地图片都可能没有可靠的类型） */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'image/avif';
  if (bytes.length >= 2 && ascii(0, 2) === 'BM') return 'image/bmp';
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 1024)))) return 'image/svg+xml';
  return null;
}

/**
 * 整篇分成几张，以及角标那一条在哪。每张图末尾都要拼上角标，所以分张时给它留出高度；
 * 切点只在角标以上找——角标自己不能被切开。
 */
export function planLongImage(docHeight: number, footerTop: number, cuts: number[]): { ranges: Range[]; band: { top: number; height: number } } {
  const band = brandBand(docHeight, footerTop);
  const usable = maxImageHeight(IMAGE_CSS_WIDTH, IMAGE_SCALE) - band.height - TOP_PAD;
  return { ranges: planRanges(docHeight, usable, cuts.filter((c) => c < band.top).sort((a, b) => a - b)), band };
}

/** 正文的一个顶层块：量出来的上下边（CSS 像素，相对正文顶端）和它序列化好的 XHTML */
export interface Block { top: number; bottom: number; xml: string }

/**
 * 文档的 [top, top + height) 这一段要放哪些块、第一个块的顶边离这一段的顶有多远（块从上一段延续下来时是负数）。
 *
 * 为什么不干脆把整篇放进去、再用负的 margin 挪到位：SVG 当图片用时是另一个排版环境，每一块的高度和页面里量的差一点点，
 * 从文档开头一路累积，几万像素之后能差出一行字——切口切到字上，画上去的图片也和文字对不齐。
 * 每一段都拿自己第一个块量出来的位置当锚点，误差就只在这一段之内累积，不到一个像素
 */
export function blocksFor(blocks: Block[], top: number, height: number): { xml: string; offset: number } {
  const picked = blocks.filter((b) => b.bottom > top && b.top < top + height);
  return picked.length ? { xml: picked.map((b) => b.xml).join(''), offset: picked[0].top - top } : { xml: '', offset: 0 };
}

/** 第一个块的上外边距在量位置时已经算进去了（offset 指的是它的边框顶），这里归零；容器自成排版上下文，外边距不往外漏 */
const TILE_STYLE = '<style xmlns="http://www.w3.org/1999/xhtml">.export-body{padding-top:0 !important;padding-bottom:0 !important;display:flow-root}.export-body &gt; :first-child{margin-top:0 !important}</style>';

/** 一段内容包成一张 SVG。style 和 xml 已经是序列化好的 XHTML；offset 见 blocksFor */
export function tileSvg(style: string, xml: string, offset: number, height: number): string {
  const w = IMAGE_CSS_WIDTH;
  // 这张 SVG 自己不放大（不写 viewBox）：Safari 内核里，<foreignObject> 中带定位的元素（KaTeX 的公式全是）不跟着 SVG 的缩放走，
  // 会按没放大的坐标、没放大的字号画到别处去。2 倍清晰度交给画布——矢量图按画上去的大小光栅化，一样清楚
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}">`
    + `<foreignObject x="0" y="0" width="${w}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${height}px;overflow:hidden;background:#fff">${style}${TILE_STYLE}`
    + `<div style="margin-top:${offset}px"><div class="export-body">${xml}</div></div></div>`
    + '</foreignObject></svg>';
}

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });

/** 一张图 → data: 地址。本地的走应用的图片协议，网上的交给外壳去取（页面自己的 CSP 不让 fetch 任意网址） */
async function imageAsDataUrl(src: string, noteDir: string | null): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  const url = resolveAssetUrl(src, noteDir);
  try {
    let blob: Blob;
    if (/^https?:/i.test(url) && !(window.api.assetBase && url.startsWith(window.api.assetBase))) {
      const bytes = await window.api.web.fetchImage(url);
      if (!bytes || bytes.byteLength > MAX_REMOTE_IMAGE) return null;
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      blob = new Blob([view.slice().buffer], { type: sniffImageType(view) || 'image/png' });
    } else {
      const fetched = await (await fetch(url)).blob();
      const type = fetched.type && fetched.type.startsWith('image/') ? fetched.type : sniffImageType(new Uint8Array(await fetched.slice(0, 1024).arrayBuffer())) || 'image/png';
      blob = fetched.type === type ? fetched : new Blob([fetched], { type });
    }
    return await downscale(await toDataUrl(blob), blob.type);
  } catch {
    return null;
  }
}

/** 长图只有 1500 像素宽，几千像素的照片原样塞进去只会让每一段都慢：先缩到用得着的大小。矢量图、动图不动 */
async function downscale(dataUrl: string, type: string): Promise<string> {
  if (/svg|gif/i.test(type)) return dataUrl;
  const img = new Image();
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('decode failed')); img.src = dataUrl; });
  const limit = IMAGE_CSS_WIDTH * IMAGE_SCALE;
  if (!img.naturalWidth || img.naturalWidth <= limit) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = limit;
  canvas.height = Math.max(1, Math.round((img.naturalHeight * limit) / img.naturalWidth));
  const g = canvas.getContext('2d');
  if (!g) return dataUrl;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(/jpe?g/i.test(type) ? 'image/jpeg' : 'image/png', 0.92);
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('这篇文档里有长图画不出来的内容'));
  img.src = src;
});

/** XML 里不允许出现的控制字符：留着的话整张 SVG 都解析不了 */
const stripInvalidXml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

/**
 * 把导出用的静态 HTML 画成一张或几张 PNG。noteDir 是文档所在的目录（相对路径的图片按它解析），未保存的文档传 null。
 */
export async function renderLongImage(staticHtml: string, noteDir: string | null): Promise<Uint8Array[]> {
  // ── 1. 内容：正文 + 角标；放不进图里的（音频、视频）换成一行字 ──
  const bodyEl = document.createElement('div');
  bodyEl.className = 'export-body';
  bodyEl.innerHTML = staticHtml + brandFooterHtml(logoData);
  bodyEl.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove());
  bodyEl.querySelectorAll('audio, video').forEach((el) => {
    const note = document.createElement('p');
    note.textContent = el.tagName === 'AUDIO' ? '🎙 这里有一段录音' : '🎞 这里有一段视频';
    el.replaceWith(note);
  });

  // ── 2. 图片全部变成 data: 地址（取不到的留下说明文字）──
  const sources = new Map<HTMLImageElement, string>();
  await Promise.all(Array.from(bodyEl.querySelectorAll('img')).map(async (img) => {
    const data = await imageAsDataUrl(img.getAttribute('src') || '', noteDir);
    if (data) { img.setAttribute('src', data); sources.set(img, data); return; }
    const missing = document.createElement('span');
    missing.style.cssText = 'color:#9aa1ab;font-size:0.9em';
    missing.textContent = `（图片没取到：${img.getAttribute('alt') || img.getAttribute('src') || ''}）`;
    img.replaceWith(missing);
  }));

  // 有公式才去拿 KaTeX 的样式和字体（三四百 KB）。界面本身已经全局加载过同名的字体，下面量尺寸时用的就是它们
  const katexCss = bodyEl.querySelector('.katex') ? await katexStyles(true) : '';

  // ── 3. 先在页面里排一遍版量尺寸：每个块在哪、图片在哪、能在哪切。Shadow DOM + all: initial 挡住界面的样式 ──
  const host = document.createElement('div');
  host.style.cssText = `all: initial; position: fixed; left: -100000px; top: 0; width: ${IMAGE_CSS_WIDTH}px; visibility: hidden; pointer-events: none;`;
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = longImageCss(katexCss);
  const frame = document.createElement('div');
  frame.style.cssText = `width:${IMAGE_CSS_WIDTH}px;overflow:hidden;background:#fff`;
  const shift = document.createElement('div');
  shift.appendChild(bodyEl);
  frame.appendChild(shift);
  shadow.append(styleEl, frame);
  document.body.appendChild(host);

  try {
    await Promise.race([
      Promise.all([document.fonts?.ready, ...Array.from(sources.keys()).map((img) => img.decode().catch(() => {}))]),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    const origin = shift.getBoundingClientRect().top;
    const docHeight = Math.ceil(shift.getBoundingClientRect().height);
    const brand = bodyEl.querySelector<HTMLElement>('.export-brand');
    const footerTop = brand ? Math.floor(brand.getBoundingClientRect().top - origin - parseFloat(getComputedStyle(brand).marginTop || '0')) : docHeight;
    const cuts = Array.from(bodyEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, pre, tr, hr, img, figure, blockquote, .callout, .math-block'), (el) => Math.floor(el.getBoundingClientRect().bottom - origin));
    const { ranges, band } = planLongImage(docHeight, footerTop, cuts);

    // 图片的盒子钉死成量出来的大小，SVG 里只留一个同样大小的空位；图片本身解码好，等会儿按位置直接画到画布上
    const boxes: ImageBox[] = [];
    for (const [img, data] of sources) {
      const rect = img.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(img).borderTopLeftRadius) || 0;
      img.style.width = `${rect.width}px`;
      img.style.height = `${rect.height}px`;
      img.setAttribute('src', BLANK_GIF);
      img.removeAttribute('srcset');
      if (rect.width < 1 || rect.height < 1) continue;
      try { boxes.push({ image: await loadImage(data), left: rect.left - frame.getBoundingClientRect().left, top: rect.top - origin, width: rect.width, height: rect.height, radius }); } catch { /* 解不开的图留空位 */ }
    }
    const serializer = new XMLSerializer();
    const style = stripInvalidXml(serializer.serializeToString(styleEl));
    const blocks: Block[] = Array.from(bodyEl.children, (el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top - origin, bottom: rect.bottom - origin, xml: stripInvalidXml(serializer.serializeToString(el)) };
    });
    /** 把文档的 [top, top + height) 画到画布的 atY 处（都是 CSS 像素） */
    const paint = async (g: CanvasRenderingContext2D, top: number, height: number, atY: number) => {
      const { xml, offset } = blocksFor(blocks, top, height);
      const tile = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(tileSvg(style, xml, offset, height))}`);
      g.save();
      g.scale(IMAGE_SCALE, IMAGE_SCALE);
      g.beginPath();
      g.rect(0, atY, IMAGE_CSS_WIDTH, height);
      g.clip(); // 跨在分段线上的图片两边各画一半，不能画出这一段的范围
      g.drawImage(tile, 0, atY, IMAGE_CSS_WIDTH, height);
      for (const b of boxes) {
        if (b.top + b.height <= top || b.top >= top + height) continue;
        const y = atY + b.top - top;
        g.save();
        g.beginPath();
        if (b.radius > 0 && typeof g.roundRect === 'function') g.roundRect(b.left, y, b.width, b.height, b.radius);
        else g.rect(b.left, y, b.width, b.height);
        g.clip();
        g.drawImage(b.image, b.left, y, b.width, b.height);
        g.restore();
      }
      g.restore();
    };

    // ── 4. 一张一张画 ──
    const parts: Uint8Array[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const last = i === ranges.length - 1;
      const pad = i > 0 ? TOP_PAD : 0;
      // 最后一张里角标本来就在；前面几张把角标那一条拼到末尾
      const tail = !last ? band.height : 0;
      const canvas = document.createElement('canvas');
      canvas.width = IMAGE_CSS_WIDTH * IMAGE_SCALE;
      canvas.height = (pad + range.height + tail) * IMAGE_SCALE;
      const g = canvas.getContext('2d');
      if (!g) throw new Error('画布创建失败');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (const tile of planTiles(docHeight, TILE_HEIGHT, range.top, range.top + range.height)) await paint(g, tile.top, tile.height, pad + tile.top - range.top);
      if (tail > 0) await paint(g, band.top, band.height, pad + range.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('这张图太大了，画布导不出来');
      parts.push(new Uint8Array(await blob.arrayBuffer()));
    }
    return parts;
  } finally {
    host.remove();
  }
}
