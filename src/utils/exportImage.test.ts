import { describe, expect, it } from 'vitest';
import { blocksFor, tileSvg, planLongImage, sniffImageType, inlineFontFaces, katexFontKey, longImageCss, IMAGE_CSS_WIDTH, type Block } from './exportImage';
import { maxImageHeight } from '../../electron/shared/imageTiles';

const block = (top: number, bottom: number, name: string): Block => ({ top, bottom, xml: `<p>${name}</p>` });

describe('长图：每一段放哪些块', () => {
  const blocks = [block(40, 100, 'a'), block(116, 4100, 'b'), block(4116, 4200, 'c'), block(4216, 9000, 'd')];

  it('只放这一段覆盖到的块，拿第一个块量出来的位置当锚点', () => {
    expect(blocksFor(blocks, 0, 4000)).toEqual({ xml: '<p>a</p><p>b</p>', offset: 40 });
    // 块从上一段延续下来：锚点是负的，超出的部分被裁掉
    expect(blocksFor(blocks, 4000, 4000)).toEqual({ xml: '<p>b</p><p>c</p><p>d</p>', offset: 116 - 4000 });
    expect(blocksFor(blocks, 8000, 1000)).toEqual({ xml: '<p>d</p>', offset: 4216 - 8000 });
  });

  it('刚好贴着这一段上下边的块不算；一个块都没有时给空内容', () => {
    expect(blocksFor(blocks, 100, 16).xml).toBe('');       // a 的底边 = 这一段的顶；b 的顶边 = 这一段的底
    expect(blocksFor([], 0, 4000)).toEqual({ xml: '', offset: 0 });
  });
});

describe('长图：一段内容包成 SVG', () => {
  it('SVG 自己不缩放（没有 viewBox）；内容靠外边距挪到位，第一个块的上外边距归零', () => {
    const svg = tileSvg('<style>S</style>', '<p>x</p>', -120, 600);
    expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_CSS_WIDTH}" height="600">`);
    expect(svg).not.toContain('viewBox');
    expect(svg).toContain(`style="width:${IMAGE_CSS_WIDTH}px;height:600px;overflow:hidden;background:#fff"`);
    expect(svg).toContain('<div style="margin-top:-120px"><div class="export-body"><p>x</p></div></div>');
    expect(svg).toContain(':first-child{margin-top:0 !important}');
    // 是一份格式正确的 XML：选择器里的 > 转义过
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });
});

describe('长图：分张', () => {
  it('不长的文档就一张；角标那一条从角标顶到文档底', () => {
    expect(planLongImage(3000, 2880, [500, 1200, 2800])).toEqual({ ranges: [{ top: 0, height: 3000 }], band: { top: 2880, height: 120 } });
  });

  it('很长的文档：切在段落的底边上，每张都给角标和页顶的留白留出了高度；角标自己不会被切开', () => {
    const limit = maxImageHeight(IMAGE_CSS_WIDTH, 2);
    const docHeight = limit * 2 + 500;
    const cuts = Array.from({ length: Math.floor(docHeight / 300) }, (_, i) => (i + 1) * 300);
    const { ranges, band } = planLongImage(docHeight, docHeight - 120, cuts);
    expect(ranges.length).toBe(3);
    expect(ranges[0].top).toBe(0);
    for (let i = 0; i < ranges.length - 1; i++) {
      expect(ranges[i].top + ranges[i].height).toBe(ranges[i + 1].top);                 // 首尾相接，一个像素不漏
      expect((ranges[i].top + ranges[i].height) % 300).toBe(0);                          // 切在段落的底边上
      expect(ranges[i].height + band.height + 40).toBeLessThanOrEqual(limit);            // 加上角标和留白也不超画布的上限
    }
    expect(ranges.at(-1)!.top + ranges.at(-1)!.height).toBe(docHeight);
    expect(ranges.every((r) => r.top + r.height <= band.top || r.top + r.height === docHeight)).toBe(true);
  });
});

describe('长图：图片与字体', () => {
  it('按文件头认图片格式（取回来的图片不一定带着可靠的类型）', () => {
    const bytes = (...n: number[]) => new Uint8Array([...n, ...new Array(16).fill(0)]);
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('GIF89a' + '\0'.repeat(10)))).toBe('image/gif');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffImageType(new TextEncoder().encode('<!DOCTYPE html><html>not an image</html>'))).toBeNull();
  });

  it('KaTeX 的 @font-face：只留 woff2 并换成内联地址；取不到的字体整条去掉，别的规则不动', async () => {
    const css = '@font-face{font-family:KaTeX_Main;src:url(fonts/Main.woff2) format("woff2"),url(fonts/Main.woff) format("woff"),url(fonts/Main.ttf) format("truetype");font-weight:400}'
      + '@font-face{font-family:KaTeX_Math;src:url(fonts/Math.woff2) format("woff2"),url(fonts/Math.ttf) format("truetype")}.katex{font:normal 1.21em KaTeX_Main}';
    const asked: string[] = [];
    const out = await inlineFontFaces(css, async (url) => { asked.push(url); return url.includes('Main') ? 'data:font/woff2;base64,AAAA' : null; });
    expect(asked).toEqual(['fonts/Main.woff2', 'fonts/Math.woff2']);
    expect(out).toBe('@font-face{font-family:KaTeX_Main;src:url(data:font/woff2;base64,AAAA) format("woff2");font-weight:400}.katex{font:normal 1.21em KaTeX_Main}');
  });

  it('样式表里的字体地址认得出是哪一个字体：开发时的原文件名、打包后带哈希的都行', () => {
    const keys = ['/node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2', '/node_modules/katex/dist/fonts/KaTeX_Main-Bold.woff2', '/node_modules/katex/dist/fonts/KaTeX_Size1-Regular.woff2'];
    expect(katexFontKey('fonts/KaTeX_Main-Regular.woff2', keys)).toBe(keys[0]);
    expect(katexFontKey('/assets/KaTeX_Main-Bold-Cx986IdX.woff2', keys)).toBe(keys[1]);
    expect(katexFontKey('./assets/KaTeX_Size1-Regular-mCD8mA8B.woff2', keys)).toBe(keys[2]);
    expect(katexFontKey('/assets/KaTeX_Fraktur-Bold-abc.woff2', keys)).toBeNull();
  });

  it('长图的样式：正文容器固定宽度，公式的样式放最前面（@font-face 得在用到它的规则之前也无妨，但不能盖掉导出样式）', () => {
    const css = longImageCss('/*katex*/');
    expect(css.startsWith('/*katex*/')).toBe(true);
    expect(css).toContain(`.export-body { width: ${IMAGE_CSS_WIDTH}px;`);
    expect(css).toContain('.export-brand');
    expect(css).not.toMatch(/(^|\s)body\s*\{/); // 塞进应用页面里量尺寸，不能有冲着 body 去的规则
  });
});
