import { describe, expect, it } from 'vitest';
import { sortFileNodes, isFileSortMode } from './fileSort';

const f = (name: string, mtime = 0, ctime = 0) => ({ name, path: `/lib/${name}`, isDirectory: false, mtime, ctime });
const d = (name: string, mtime = 0) => ({ name, path: `/lib/${name}`, isDirectory: true, mtime, ctime: 0 });
const names = (nodes: { name: string }[]) => nodes.map((n) => n.name);

describe('sortFileNodes', () => {
  const nodes = [f('笔记 10.md', 300, 10), d('项目', 999), f('笔记 2.md', 100, 30), f('a.md', 200, 20), d('附件', 1)];

  it('文件夹永远在前、总按名称排；按名称时数字按大小排（2 在 10 前面）', () => {
    expect(names(sortFileNodes(nodes, 'name-asc'))).toEqual(['附件', '项目', 'a.md', '笔记 2.md', '笔记 10.md']);
    expect(names(sortFileNodes(nodes, 'name-desc'))).toEqual(['附件', '项目', '笔记 10.md', '笔记 2.md', 'a.md']);
  });
  it('按修改 / 创建时间：只有文件跟着变，文件夹不动', () => {
    expect(names(sortFileNodes(nodes, 'mtime-desc'))).toEqual(['附件', '项目', '笔记 10.md', 'a.md', '笔记 2.md']);
    expect(names(sortFileNodes(nodes, 'mtime-asc'))).toEqual(['附件', '项目', '笔记 2.md', 'a.md', '笔记 10.md']);
    expect(names(sortFileNodes(nodes, 'ctime-desc'))).toEqual(['附件', '项目', '笔记 2.md', 'a.md', '笔记 10.md']);
  });
  it('时间一样或拿不到：退回按名称，顺序稳定；不改原数组', () => {
    const same = [f('b.md'), f('a.md'), { name: 'c.md', path: '/lib/c.md', isDirectory: false }];
    expect(names(sortFileNodes(same, 'mtime-desc'))).toEqual(['a.md', 'b.md', 'c.md']);
    expect(names(same)).toEqual(['b.md', 'a.md', 'c.md']);
  });
  it('isFileSortMode 只认那六种', () => {
    expect([isFileSortMode('mtime-desc'), isFileSortMode('size'), isFileSortMode(null)]).toEqual([true, false, false]);
  });
});
