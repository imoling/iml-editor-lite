/**
 * 导出长图时的分块计划。纯函数。
 *
 * 一次截图的高度有上限（GPU 纹理约 16384 像素，2 倍清晰度下只有 8000 多个 CSS 像素），长笔记得一块一块截、再拼起来。
 * 页面滚不到的地方（最后一屏）实际滚动位置会比想要的小，那一块要从截图的中间开始取。
 * 拼出来的整张图也有上限（画布面积），超了就分成几张。
 */
export interface Tile {
  /** 这一块要覆盖的文档区间 [top, top + height)，CSS 像素 */
  top: number;
  height: number;
  /** 截这一块时页面要滚到哪（不会超过能滚的最大值） */
  scrollTo: number;
  /** 这一块在那次截图里从多高的地方开始（CSS 像素）：只有滚不动的最后一屏不是 0 */
  offsetInShot: number;
}

/** 把文档的 [from, to) 这一段切成一块块；不传 from / to 就是整篇 */
export function planTiles(docHeight: number, viewportHeight: number, from = 0, to = docHeight): Tile[] {
  const total = Math.max(1, Math.ceil(docHeight));
  const view = Math.max(1, Math.floor(viewportHeight));
  const maxScroll = Math.max(0, total - view);
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(total, Math.ceil(to));
  const tiles: Tile[] = [];
  for (let top = start; top < end; top += view) {
    const height = Math.min(view, end - top);
    const scrollTo = Math.min(top, maxScroll);
    tiles.push({ top, height, scrollTo, offsetInShot: top - scrollTo });
  }
  return tiles;
}

/** 一张图覆盖的文档区间 [top, top + height)，CSS 像素 */
export interface Range { top: number; height: number }

/**
 * 整篇按每张图的高度上限分成几张，尽量在段落 / 列表项 / 表格行的底边切，别把一行字切成两半。
 * cuts 是可以切的位置（文档坐标，升序）。上限之内找不到切点（比如一个特别高的代码块）就只好硬切；
 * 切点也不能太靠上（不到上限的一半），不然一张很高的图后面跟一张很矮的。
 */
export function planRanges(docHeight: number, maxHeight: number, cuts: number[]): Range[] {
  const total = Math.max(1, Math.ceil(docHeight));
  const max = Math.max(1, Math.floor(maxHeight));
  const ranges: Range[] = [];
  let top = 0;
  while (top < total) {
    if (total - top <= max) { ranges.push({ top, height: total - top }); break; }
    const limit = top + max;
    let end = limit;
    for (const c of cuts) {
      if (c > limit) break;
      if (c > top + max / 2) end = Math.floor(c);
    }
    ranges.push({ top, height: end - top });
    top = end;
  }
  return ranges;
}

/** 一张图最多放多高（CSS 像素）：画布面积上限约 2.68 亿像素，留一点余量 */
export function maxImageHeight(cssWidth: number, scale: number): number {
  const MAX_AREA = 250_000_000;
  const MAX_SIDE = 32000;
  const devWidth = Math.max(1, Math.round(cssWidth * scale));
  return Math.floor(Math.min(MAX_SIDE, MAX_AREA / devWidth) / scale);
}

/** 分成几张时的文件名：note.png → note-1.png、note-2.png；只有一张就不加序号 */
export function numberedPath(filePath: string, index: number, count: number): string {
  if (count <= 1) return filePath;
  const dot = filePath.lastIndexOf('.');
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return dot > slash ? `${filePath.slice(0, dot)}-${index + 1}${filePath.slice(dot)}` : `${filePath}-${index + 1}`;
}
