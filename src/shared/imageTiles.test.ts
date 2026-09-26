import { describe, expect, it } from 'vitest';
import { planTiles, planRanges, maxImageHeight, numberedPath } from './imageTiles';

describe('长图分块', () => {
  it('一屏放得下：就一块', () => {
    expect(planTiles(900, 4000)).toEqual([{ top: 0, height: 900, scrollTo: 0, offsetInShot: 0 }]);
  });

  it('块与块首尾相接、不重不漏，加起来正好是整篇的高度', () => {
    const tiles = planTiles(10500, 4000);
    expect(tiles.map((t) => [t.top, t.height])).toEqual([[0, 4000], [4000, 4000], [8000, 2500]]);
    expect(tiles.reduce((n, t) => n + t.height, 0)).toBe(10500);
    tiles.forEach((t, i) => { if (i) expect(t.top).toBe(tiles[i - 1].top + tiles[i - 1].height); });
  });

  it('最后一屏滚不到想要的位置：从那次截图的中间开始取，取到的正好是没覆盖过的那一段', () => {
    const last = planTiles(10500, 4000)[2];
    // 能滚的最大值是 10500 - 4000 = 6500；想要的是 8000 起的那段，它在这次截图里从 1500 处开始
    expect(last).toEqual({ top: 8000, height: 2500, scrollTo: 6500, offsetInShot: 1500 });
    expect(last.scrollTo + last.offsetInShot).toBe(last.top);
    expect(last.offsetInShot + last.height).toBe(4000);
  });

  it('高度正好是整数倍、带小数的高度', () => {
    expect(planTiles(8000, 4000)).toHaveLength(2);
    expect(planTiles(8000.4, 4000).map((t) => t.height)).toEqual([4000, 4000, 1]);
  });

  it('一张图放不下就分几张；文件名带序号，只有一张时不带', () => {
    const ranges = planRanges(100000, maxImageHeight(750, 2), []);
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges.every((r) => r.height <= maxImageHeight(750, 2))).toBe(true);
    expect(planRanges(9000, maxImageHeight(750, 2), [])).toHaveLength(1);
    expect(numberedPath('/a/笔记.png', 0, 1)).toBe('/a/笔记.png');
    expect(numberedPath('/a/笔记.png', 1, 3)).toBe('/a/笔记-2.png');
    expect(numberedPath('/a.b/笔记', 0, 2)).toBe('/a.b/笔记-1');
  });

  it('每张图的高度上限同时受画布面积和单边长度限制', () => {
    expect(maxImageHeight(750, 2)).toBe(16000);      // 单边 32000 设备像素 ÷ 2
    expect(maxImageHeight(4000, 2)).toBe(15625);     // 面积 2.5 亿 ÷ 8000 ÷ 2
  });
});

describe('planTiles 只切一段', () => {
  it('从 from 到 to，块的高度按段尾截断，滚不动的最后一屏从截图中间取', () => {
    const tiles = planTiles(10000, 4000, 3000, 9000);
    expect(tiles).toEqual([
      { top: 3000, height: 4000, scrollTo: 3000, offsetInShot: 0 },
      { top: 7000, height: 2000, scrollTo: 6000, offsetInShot: 1000 },
    ]);
    expect(planTiles(10000, 4000)).toEqual(planTiles(10000, 4000, 0, 10000));
  });
});

describe('planRanges：分张尽量在段落边界切', () => {
  it('放得下就一张', () => {
    expect(planRanges(5000, 16000, [1000, 4990])).toEqual([{ top: 0, height: 5000 }]);
  });

  it('上限之内取最靠下的切点，最后一张到文档底', () => {
    expect(planRanges(30000, 16000, [3000, 9000, 15500, 15990, 16010, 25000, 29500])).toEqual([
      { top: 0, height: 15990 },
      { top: 15990, height: 14010 },
    ]);
  });

  it('切点都太靠上（不到上限一半）或根本没有：硬切在上限处', () => {
    expect(planRanges(20000, 16000, [3000, 7000])).toEqual([{ top: 0, height: 16000 }, { top: 16000, height: 4000 }]);
    expect(planRanges(20000, 16000, [])).toEqual([{ top: 0, height: 16000 }, { top: 16000, height: 4000 }]);
  });

  it('各张首尾相接、盖住整篇', () => {
    const cuts = Array.from({ length: 200 }, (_, i) => (i + 1) * 333);
    const ranges = planRanges(66600, 16000, cuts);
    let top = 0;
    for (const r of ranges) { expect(r.top).toBe(top); expect(r.height).toBeGreaterThan(0); expect(r.height).toBeLessThanOrEqual(16000); top += r.height; }
    expect(top).toBe(66600);
    // 不是最后一张的都切在切点上
    for (const r of ranges.slice(0, -1)) expect(cuts).toContain(r.top + r.height);
  });
});
