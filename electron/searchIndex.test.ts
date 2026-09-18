import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SearchIndex } from './searchIndex';

let root: string;
const write = (rel: string, content: string) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-index-'));
  write('a.md', '# 苹果笔记\n\n今天吃了苹果，苹果很甜。');
  write('sub/b.md', '# 香蕉\n\n香蕉和 Apple 都是水果。链接到 [[苹果笔记]] 和 [[苹果笔记|别名]]。');
  write('sub/.hidden.md', '苹果 隐藏');
  write('pic.png', '苹果');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('SearchIndex', () => {
  it('递归建索引，跳过隐藏文件和非笔记文件；标题取一级标题', async () => {
    const index = new SearchIndex();
    await index.build(root);
    expect(index.status()).toMatchObject({ count: 2, building: false });
    expect(index.listNotes().map((n) => n.title)).toEqual(['苹果笔记', '香蕉']);
  });

  it('不区分大小写，多词 AND，标题命中优先，片段带上下文', async () => {
    const index = new SearchIndex();
    await index.build(root);
    const results = index.search('苹果');
    expect(results.map((r) => r.title)).toEqual(['苹果笔记', '香蕉']);
    expect(results[0].count).toBe(3);
    expect(results[0].snippets[0].match).toBe('苹果');
    expect(index.search('apple 香蕉').map((r) => r.title)).toEqual(['香蕉']);
    expect(index.search('apple 苹果笔记')).toHaveLength(1);
    expect(index.search('')).toEqual([]);
  });

  it('refresh 增量更新：改文件、删文件、新目录', async () => {
    const index = new SearchIndex();
    await index.build(root);
    const c = write('c.md', '# 樱桃\n樱桃');
    await index.refresh([c]);
    expect(index.search('樱桃')).toHaveLength(1);
    fs.unlinkSync(c);
    await index.refresh([c]);
    expect(index.search('樱桃')).toHaveLength(0);
    write('deep/d.md', '# 榴莲');
    await index.refresh([path.join(root, 'deep')]);
    expect(index.search('榴莲')).toHaveLength(1);
    fs.rmSync(path.join(root, 'deep'), { recursive: true });
    await index.refresh([path.join(root, 'deep')]);
    expect(index.search('榴莲')).toHaveLength(0);
  });

  it('反向链接按目标标题匹配，别名写法也算', async () => {
    const index = new SearchIndex();
    await index.build(root);
    const links = index.backlinks('苹果笔记');
    expect(links.map((l) => l.title)).toEqual(['香蕉']);
    expect(links[0].snippets).toHaveLength(2);
    expect(index.backlinks('不存在')).toEqual([]);
  });

  it('标签：正文 #标签 与 frontmatter tags 合并统计，层级标签计入父标签', async () => {
    write('tagged/one.md', '---\ntags: [读书, 项目/甲]\n---\n\n# 一\n\n正文 #想法 #项目/乙\n\n```\n#不是标签\n```');
    write('tagged/two.md', '# 二\n\n#读书 和 #想法');
    const index = new SearchIndex();
    await index.build(root);
    const tags = Object.fromEntries(index.listTags().map((t) => [t.tag, t.count]));
    expect(tags).toMatchObject({ 读书: 2, 想法: 2, 项目: 1, '项目/甲': 1, '项目/乙': 1 });
    expect(tags['不是标签']).toBeUndefined();
    expect(index.notesByTag('项目').map((n) => n.title)).toEqual(['一']);
    expect(index.notesByTag('读书').map((n) => n.title).sort()).toEqual(['一', '二']);
    // frontmatter 里的 # 注释不会被当成标题
    expect(SearchIndex.titleOf('/x/文件名.md', '---\n# 注释\ntags: []\n---\n\n正文')).toBe('文件名');
  });
});
