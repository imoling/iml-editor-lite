import { describe, expect, it } from 'vitest';
import { wikiHeadingCandidates, toNameCandidates } from './wikiComplete';

const notes = [
  { path: '/lib/周会.md', title: '项目周会', aliases: ['例会'] },
  { path: '/lib/a.md', title: 'A' },
];
const files: Record<string, string> = { '/lib/周会.md': '# 项目周会\n\n## 上周\n\n## 本周\n\n```\n## 代码里的不算\n```\n' };
const ctx = { currentPath: '/lib/a.md', currentContent: '# A\n\n## 小结\n', readNote: async (p: string) => files[p] ?? null };

describe('[[笔记# 小节补全', () => {
  it('没有 # 时返回 null，交回给笔记名补全', async () => {
    expect(await wikiHeadingCandidates(notes, '周会', ctx)).toBeNull();
  });

  it('列出那篇笔记的小节，按 # 后面的字过滤；文件名、标题、别名都能指到那篇', async () => {
    expect((await wikiHeadingCandidates(notes, '周会#', ctx))!.map((h) => h.target)).toEqual(['周会#项目周会', '周会#上周', '周会#本周']);
    expect((await wikiHeadingCandidates(notes, '例会#本', ctx))!.map((h) => [h.target, h.level, h.path])).toEqual([['例会#本周', 2, '/lib/周会.md']]);
  });

  it('[[# 列本篇的小节，用的是编辑器里的内容（没存盘的也算）', async () => {
    expect((await wikiHeadingCandidates(notes, '#', ctx))!.map((h) => h.target)).toEqual(['#A', '#小结']);
  });

  it('笔记不存在、读不到、或在找块 ID 时给空列表', async () => {
    expect(await wikiHeadingCandidates(notes, '没有#', ctx)).toEqual([]);
    expect(await wikiHeadingCandidates([{ path: '/lib/丢了.md', title: '丢了' }], '丢了#', ctx)).toEqual([]);
    expect(await wikiHeadingCandidates(notes, '周会#^', ctx)).toEqual([]);
  });

  it('笔记名候选用文件名，别名跟着带上', () => {
    expect(toNameCandidates(notes)[0]).toMatchObject({ title: '周会', aliases: ['例会'] });
  });
});
