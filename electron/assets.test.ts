import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }, net: { fetch: vi.fn() } }));

import { assetFileName, findOrphanImages, filterTrashable, extractHtmlTitle, detectCharset, nameVariants, parseRange, AUDIO_EXT_RE } from './assets';

let root: string;
const write = (rel: string, content: string | Buffer) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-assets-'));
  write('笔记.md', '正文 ![图](assets/used.png) 和 <img src="assets/html%20ref.png"> 以及 ![[嵌入.webp]]');
  write('assets/used.png', 'x');
  write('assets/html ref.png', 'x');
  write('assets/嵌入.webp', 'x');
  write('assets/orphan.png', 'xxxx');
  write('sub/assets/pasted-later.png', 'x');
  write('.hidden/skip.png', 'x');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('assetFileName', () => {
  const now = new Date(2026, 8, 18, 9, 5, 7);
  it('剪贴板的通用名换成时间戳；空格换成连字符；保留中文', () => {
    expect(assetFileName('image.png', now)).toBe('img-20260918-090507.png');
    expect(assetFileName('屏幕截图.PNG', now)).toBe('img-20260918-090507.png');
    expect(assetFileName('架构 设计  图 (1).webp', now)).toBe('架构-设计-图-1.webp');
    expect(assetFileName('a/b:c?.jpg', now)).toBe('bc.jpg');
    expect(assetFileName('noext', now)).toBe('noext.png');
  });
});

describe('findOrphanImages', () => {
  it('只列出文件名没在任何笔记里出现过的图片（URI 编码、嵌入写法都算引用），跳过隐藏目录', async () => {
    const orphans = await findOrphanImages(root);
    expect(orphans.map((o) => o.relative).sort()).toEqual([path.join('assets', 'orphan.png'), path.join('sub', 'assets', 'pasted-later.png')].sort());
    expect(orphans.find((o) => o.relative.endsWith('orphan.png'))?.size).toBe(4);
  });

  it('未保存的标签页内容也算引用：刚粘贴还没落盘的图片不会被误判', async () => {
    const orphans = await findOrphanImages(root, ['刚粘贴的 ![](assets/pasted-later.png)']);
    expect(orphans.map((o) => path.basename(o.path))).toEqual(['orphan.png']);
  });

  it('nameVariants 覆盖原样 / 编码 / NFD 写法', () => {
    expect(nameVariants('截图 1.png')).toEqual(expect.arrayContaining(['截图 1.png', '截图%201.png', encodeURIComponent('截图 1.png').toLowerCase()]));
  });
});

describe('filterTrashable', () => {
  it('只放行笔记库里的图片文件', () => {
    const inside = path.join(root, 'assets', 'orphan.png');
    expect(filterTrashable(root, [inside, path.join(root, '笔记.md'), '/etc/passwd', path.join(root, '..', 'outside.png')])).toEqual([inside]);
  });
});

describe('网页标题', () => {
  it('取 <title>，解码实体、压缩空白；没有时取 og:title', () => {
    expect(extractHtmlTitle('<html><head><title>\n  标题 &amp; 副标题 &#8212; 站点  </title></head>')).toBe('标题 & 副标题 — 站点');
    expect(extractHtmlTitle('<meta property="og:title" content="OG 标题">')).toBe('OG 标题');
    expect(extractHtmlTitle('<p>没有标题</p>')).toBeNull();
  });

  it('编码：响应头优先，其次 meta；gb2312 按 gbk 解', () => {
    expect(detectCharset('text/html; charset=GBK', '')).toBe('gbk');
    expect(detectCharset('text/html', '<meta charset="gb2312">')).toBe('gbk');
    expect(detectCharset('', '')).toBe('utf-8');
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // 「中文」
    expect(new TextDecoder('gbk').decode(gbk)).toBe('中文');
  });
});

describe('录音回听：音频走 iml-asset:// 时的分段请求', () => {
  it('三种 Range 写法都换算成闭区间；结尾超出文件就截到文件末尾', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=200-299', 1000)).toEqual({ start: 200, end: 299 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('不合法、或起点超出文件：返回 null（回 416），不能回一段错位的数据', () => {
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
    expect(parseRange('bytes=300-200', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });

  it('只放行音频扩展名', () => {
    expect(AUDIO_EXT_RE.test('/lib/assets/录音-20260920-011305.webm')).toBe(true);
    expect(AUDIO_EXT_RE.test('/etc/passwd')).toBe(false);
    expect(AUDIO_EXT_RE.test('/lib/笔记.md')).toBe(false);
  });
});
