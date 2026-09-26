import { describe, expect, it } from 'vitest';
import { brandFooterHtml, brandBand, BRAND_TEXT } from './imageBrand';

describe('长图角标', () => {
  it('有 logo 时图文都放，没有就只放文字', () => {
    expect(brandFooterHtml('data:image/png;base64,AAAA')).toBe(`<footer class="export-brand"><img src="data:image/png;base64,AAAA" alt=""><span>${BRAND_TEXT}</span></footer>`);
    expect(brandFooterHtml(null)).toBe(`<footer class="export-brand"><span>${BRAND_TEXT}</span></footer>`);
  });

  it('角标条：从角标顶到文档底，含底部留白', () => {
    expect(brandBand(1000, 900)).toEqual({ top: 900, height: 100 });
    // 量不到（角标找不到）按 0 高处理，不能拼出负数
    expect(brandBand(1000, 1200)).toEqual({ top: 1000, height: 0 });
    expect(brandBand(1000, -5)).toEqual({ top: 0, height: 1000 });
  });
});
