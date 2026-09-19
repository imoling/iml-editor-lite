import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chunkNote, plainText, normalize, dot, centroid, encodeVector, decodeVector } from './chunk';
import { VectorStore } from './store';
import { lexicalTerms, lexicalScore, rerankChunks } from './retrieve';
import { EMBED_CATALOG, findEmbedSpec, DEFAULT_EMBED_MODEL } from './catalog';
import { buildServerArgs } from '../localModel/server';

describe('嵌入模型目录', () => {
  it('每一项都有完整的下载与校验信息，分块上限留足 token 余量', () => {
    for (const m of EMBED_CATALOG) {
      expect(m.file.endsWith('.gguf')).toBe(true);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.size).toBeGreaterThan(10 * 1024 * 1024);
      // 中文约 1 字 1 token：分块字符数必须明显小于 token 上限
      expect(m.chunkChars).toBeLessThanOrEqual(m.maxTokens * 0.75);
      expect(m.queryPrefix.length).toBeGreaterThan(0);
    }
    expect(findEmbedSpec(DEFAULT_EMBED_MODEL)?.recommended).toBe(true);
  });

  it('嵌入模式的 llama-server 参数：上下文在各槽之间平分，批大小与之相同', () => {
    const args = buildServerArgs({ bin: '', modelPath: '/m/e.gguf', alias: 'e', port: 18180, ctxSize: 2048, thinking: false, embedding: { slots: 4 } });
    expect(args).toEqual(['-m', '/m/e.gguf', '-a', 'e', '--host', '127.0.0.1', '--port', '18180', '--embedding', '-c', '2048', '-b', '2048', '-ub', '2048', '-np', '4', '--no-webui', '-ngl', '99']);
    expect(args).not.toContain('--jinja');
  });
});

describe('chunkNote', () => {
  it('按标题分节，块文本带上「笔记标题 › 小节」，frontmatter 与链接地址不进向量', () => {
    const md = '---\ntags: [a]\n---\n\n# 向量检索\n\n第一节的内容，讲 HNSW 索引是怎么构建的。\n\n## 应用\n\n可以给笔记做 [语义搜索](https://example.com/very/long/url)。';
    const chunks = chunkNote('向量检索', md, 360);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text.startsWith('向量检索 › 向量检索\n')).toBe(true);
    expect(chunks[1].text.startsWith('向量检索 › 应用\n')).toBe(true);
    expect(chunks.map((c) => c.text).join('')).not.toContain('example.com');
    expect(chunks.map((c) => c.text).join('')).not.toContain('tags:');
    expect(chunks[1].preview).toBe('可以给笔记做 语义搜索 。'.replace(' 。', '。'));
  });

  it('任何一块都不超过上限；长段落按句切开', () => {
    const long = '这是一句用来凑长度的话，里面没有什么实际含义。'.repeat(80);
    const chunks = chunkNote('长文', `# 长文\n\n${long}`, 360);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(360);
  });

  it('只有标题的笔记也给一个块；围栏代码不会被当成标题切节', () => {
    expect(chunkNote('空笔记', '', 360)).toEqual([{ text: '空笔记', preview: '' }]);
    const chunks = chunkNote('代码', '正文开头的一段说明文字。\n\n```sh\n# 这不是标题\necho hello world\n```', 360);
    expect(chunks).toHaveLength(1);
  });

  it('plainText 去掉 data URL 与表格分隔行', () => {
    expect(plainText('![](data:image/png;base64,AAAA) | a |\n| --- |\n| b |')).not.toContain('base64');
  });
});

describe('向量运算与向量库', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-vec-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const v = (...n: number[]) => normalize(Float32Array.from(n));

  it('归一化、点积、质心、序列化往返', () => {
    expect(dot(v(3, 4), v(3, 4))).toBeCloseTo(1, 5);
    expect(dot(v(1, 0), v(0, 1))).toBeCloseTo(0, 5);
    expect(Array.from(centroid([v(1, 0), v(0, 1)])).map((x) => x.toFixed(3))).toEqual(['0.707', '0.707']);
    expect(Array.from(decodeVector(encodeVector(v(1, 2, 3))))).toEqual(Array.from(v(1, 2, 3)));
  });

  it('相关笔记按质心相似度排序并排除自己；语义搜索取每篇最高分的块', async () => {
    const file = path.join(dir, 'idx.json');
    const store = new VectorStore(file, 'm', 2);
    store.upsert({ path: '/a.md', title: 'A', stamp: '1', chunks: [{ preview: 'a1', vec: v(1, 0) }] });
    store.upsert({ path: '/b.md', title: 'B', stamp: '1', chunks: [{ preview: 'b1', vec: v(0.9, 0.1) }, { preview: 'b2', vec: v(0.2, 0.98) }] });
    store.upsert({ path: '/c.md', title: 'C', stamp: '1', chunks: [{ preview: 'c1', vec: v(0, 1) }] });

    const related = store.related('/a.md', 5, 0.5);
    expect(related.map((r) => r.path)).toEqual(['/b.md']);
    expect(related[0].snippet).toBe('b1');

    const hits = store.search(v(0, 1), 5, 0.5, 0.5);
    expect(hits.map((h) => h.path)).toEqual(['/c.md', '/b.md']);
    expect(hits[1].snippet).toBe('b2');

    // 相对截断：比第一名低太多的不要
    expect(store.search(v(0, 1), 5, 0.1, 0.01).map((h) => h.path)).toEqual(['/c.md']);

    // 落盘再读回，结果不变；换了模型或维度则从空库开始
    await store.save();
    const again = new VectorStore(file, 'm', 2);
    await again.load();
    expect(again.notes.size).toBe(3);
    expect(again.related('/a.md', 5, 0.5).map((r) => r.path)).toEqual(['/b.md']);
    const other = new VectorStore(file, 'other-model', 2);
    await other.load();
    expect(other.notes.size).toBe(0);
  });
});

describe('问你的笔记：分块检索与重排', () => {
  const v = (...n: number[]) => normalize(Float32Array.from(n));

  it('searchChunks 按分块返回、带序号，不按篇去重', () => {
    const store = new VectorStore(path.join(os.tmpdir(), `iml-ask-${Date.now()}.json`), 'm', 2);
    store.upsert({ path: '/a.md', title: 'A', stamp: '1', chunks: [{ preview: 'a0', vec: v(1, 0) }, { preview: 'a1', vec: v(0.95, 0.3) }, { preview: 'a2', vec: v(0, 1) }] });
    store.upsert({ path: '/b.md', title: 'B', stamp: '1', chunks: [{ preview: 'b0', vec: v(0.8, 0.6) }] });
    const hits = store.searchChunks(v(1, 0), 10, 0.5);
    expect(hits.map((h) => `${h.path}#${h.index}`)).toEqual(['/a.md#0', '/a.md#1', '/b.md#0']);   // a2 低于下限被滤掉
    expect(hits[1].preview).toBe('a1');
  });

  it('从问题里取字面词：中文二元组、英文和数字整词，疑问词与虚词不参与', () => {
    const terms = lexicalTerms('老王说的排期是哪天');
    expect(terms).toEqual(expect.arrayContaining(['老王', '排期']));
    expect(terms).not.toContain('哪天');
    expect(terms.some((t) => t.includes('的'))).toBe(false);          // 二元组不会跨过被去掉的虚词
    expect(lexicalTerms('llama-server 的端口是 18080 吗')).toEqual(expect.arrayContaining(['llama-server', '18080', '端口']));
    expect(lexicalTerms('什么是什么')).toEqual([]);
  });

  it('字面重合度 = 问题里的词有多大比例出现在这一块里，不区分大小写', () => {
    expect(lexicalScore(['老王', '排期'], '周会纪要\n老王负责排期')).toBe(1);
    expect(lexicalScore(['老王', '排期'], '老张负责排期')).toBe(0.5);
    expect(lexicalScore(['electron'], '用 Electron 打包')).toBe(1);
    expect(lexicalScore([], '随便什么')).toBe(0);
  });

  it('向量分接近时，字面命中的那块排前面 —— 精确信息（人名、数字）靠它', () => {
    const ranked = rerankChunks([
      { path: '/a.md', title: 'A', index: 0, score: 0.62, text: '项目排期\n整体计划在第四季度完成' },
      { path: '/b.md', title: 'B', index: 0, score: 0.58, text: '周会纪要\n老王说排期定在 9 月 22 日' },
    ], '老王说的排期是哪天');
    expect(ranked[0].path).toBe('/b.md');
    expect(ranked[0].lexical).toBeGreaterThan(ranked[1].lexical);
  });

  it('向量分差得远时，字面命中翻不了盘', () => {
    const ranked = rerankChunks([
      { path: '/a.md', title: 'A', index: 0, score: 0.80, text: '完全讲的是这件事但用词不同' },
      { path: '/b.md', title: 'B', index: 0, score: 0.45, text: '老王 排期' },
    ], '老王 排期', { window: 1 });
    expect(ranked[0].path).toBe('/a.md');
  });

  it('同一篇最多取 perNote 块，总数不超过 limit，比第一名低一大截的丢掉', () => {
    const long = Array.from({ length: 6 }, (_, i) => ({ path: '/long.md', title: 'L', index: i, score: 0.7 - i * 0.01, text: `第 ${i} 块` }));
    const ranked = rerankChunks([...long, { path: '/other.md', title: 'O', index: 0, score: 0.6, text: '另一篇' }, { path: '/noise.md', title: 'N', index: 0, score: 0.3, text: '噪声' }], '随便问问', { perNote: 3, limit: 8 });
    expect(ranked.filter((c) => c.path === '/long.md')).toHaveLength(3);
    expect(ranked.map((c) => c.path)).toContain('/other.md');
    expect(ranked.map((c) => c.path)).not.toContain('/noise.md');
    expect(rerankChunks([], '空')).toEqual([]);
  });
});
