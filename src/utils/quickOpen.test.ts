import { describe, it, expect } from 'vitest';
import { matchTerm, matchInitials, rankNotes, folderOf } from './quickOpen';

const ROOT = '/lib';
const NOTES = [
  { path: '/lib/项目/周会纪要 2026-09-15.md', title: '周会纪要 2026-09-15' },
  { path: '/lib/项目/语义搜索调研.md', title: '语义搜索调研' },
  { path: '/lib/项目/向量数据库选型.md', title: '向量数据库选型' },
  { path: '/lib/读书笔记/《原则》.md', title: '《原则》' },
  { path: '/lib/读书笔记/《思考，快与慢》.md', title: '《思考，快与慢》' },
  { path: '/lib/README.md', title: 'README' },
  { path: '/lib/日记/2026-09-17.md', title: '2026-09-17' },
  { path: '/lib/生活/fanqie.md', title: '番茄炒蛋' },   // 标题和文件名不一样
];
const titles = (q: string, opts: any = {}) => rankNotes(NOTES, q, { root: ROOT, ...opts }).map((h) => h.title);

describe('matchTerm', () => {
  it('连续子串：给出命中区间，越靠前分越高', () => {
    expect(matchTerm('语义搜索调研', '搜索')).toMatchObject({ ranges: [[2, 4]] });
    expect(matchTerm('搜索语义', '搜索')!.score).toBeGreaterThan(matchTerm('语义搜索', '搜索')!.score);
  });

  it('不区分大小写', () => {
    expect(matchTerm('README', 'read')).toMatchObject({ ranges: [[0, 4]] });
  });

  it('零散字符按顺序出现也算，挨着的合并成一段；分数低于连续子串', () => {
    const loose = matchTerm('README', 'rdme')!;
    expect(loose.ranges).toEqual([[0, 1], [3, 6]]);
    expect(loose.score).toBeLessThan(matchTerm('README', 'read')!.score);
  });

  it('顺序不对或缺字符就不算', () => {
    expect(matchTerm('README', 'emr')).toBeNull();
    expect(matchTerm('语义搜索', '搜义')).toBeNull();
  });
});

describe('rankNotes', () => {
  it('敲几个字就能找到，最贴切的排第一', () => {
    expect(titles('原则')[0]).toBe('《原则》');
    expect(titles('语义')[0]).toBe('语义搜索调研');
    expect(titles('rdme')).toEqual(['README']);
  });

  it('多个词都得匹配上；标题里没有的词可以落在文件夹上', () => {
    expect(titles('周会 项目')).toEqual(['周会纪要 2026-09-15']);
    expect(titles('读书 原则')).toEqual(['《原则》']);
    expect(titles('周会 读书')).toEqual([]);
  });

  it('标题命中排在只有文件夹命中的前面', () => {
    const notes = [{ path: '/lib/调研/a.md', title: '随手记' }, { path: '/lib/x/b.md', title: '调研计划' }];
    expect(rankNotes(notes, '调研', { root: ROOT }).map((h) => h.title)).toEqual(['调研计划', '随手记']);
  });

  it('标题（一级标题）和文件名不一样时，两边都能搜到', () => {
    expect(titles('番茄')).toEqual(['番茄炒蛋']);
    expect(titles('fanqie')).toEqual(['番茄炒蛋']);
    // 命中的是文件名时，标题上不该有高亮
    expect(rankNotes(NOTES, 'fanqie', { root: ROOT })[0].ranges).toEqual([]);
  });

  it('同样贴切时，最近打开过的排前面；但压不过明显更贴切的', () => {
    expect(titles('2026')[0]).toBe('2026-09-17');   // 开头命中
    expect(titles('2026', { recentPaths: ['/lib/项目/周会纪要 2026-09-15.md'] })[0]).toBe('2026-09-17');
    const tie = [{ path: '/lib/a.md', title: '会议 A' }, { path: '/lib/b.md', title: '会议 B' }];
    expect(rankNotes(tie, '会议', { root: ROOT, recentPaths: ['/lib/b.md'] })[0].title).toBe('会议 B');
  });

  it('没输入时先列最近打开的（按最近程度），再接其余的', () => {
    const list = titles('', { recentPaths: ['/lib/README.md', '/lib/读书笔记/《原则》.md'] });
    expect(list.slice(0, 2)).toEqual(['README', '《原则》']);
    expect(list).toHaveLength(NOTES.length);
  });

  it('结果带上相对文件夹，条数有上限', () => {
    expect(rankNotes(NOTES, '原则', { root: ROOT })[0].folder).toBe('读书笔记');
    expect(rankNotes(NOTES, '', { root: ROOT, limit: 3 })).toHaveLength(3);
  });
});

describe('拼音首字母', () => {
  const notes = [
    { path: '/lib/项目周会.md', title: '项目周会' },
    { path: '/lib/读书笔记.md', title: '读书笔记：《原则》' },
    { path: '/lib/xmzh-notes.md', title: 'xmzh notes' },
    { path: '/lib/2026-09-18.md', title: '会议记录', aliases: ['项目复盘'] },
  ];
  it('敲首字母能找到，高亮落在对应的汉字上', () => {
    const hit = rankNotes(notes, 'dsbj')[0];
    expect(hit.title).toBe('读书笔记：《原则》');
    expect(hit.ranges.map(([a, b]) => hit.title.slice(a, b))).toEqual(['读书笔记']);
    expect(rankNotes(notes, 'zh').map((h) => h.title)).toContain('项目周会');
  });
  it('标题里本来就有这串英文的排在前面；别名也能用首字母找', () => {
    expect(rankNotes(notes, 'xmzh').map((h) => h.title)).toEqual(['xmzh notes', '项目周会']);
    expect(rankNotes(notes, 'xmfp').map((h) => [h.title, h.alias])).toEqual([['会议记录', '项目复盘']]);
  });
  it('不放宽到噪音：单个字母不算、首字母不连着不算、纯英文标题不走这条路', () => {
    expect(matchInitials('项目周会', 'x')).toBeNull();
    expect(matchInitials('项目周会', 'xzh')).toBeNull();
    expect(matchInitials('project notes', 'pn')).toBeNull();
    expect(matchInitials('项目周会', '周会')).toBeNull();
  });
});

describe('别名', () => {
  const notes = [
    { path: '/lib/2026-09-18.md', title: '项目周会', aliases: ['例会', 'Weekly Sync'] },
    { path: '/lib/例会须知.md', title: '例会须知' },
  ];
  it('敲别名也能找到那篇，并带上是哪个别名命中的', () => {
    const hits = rankNotes(notes, 'weekly');
    expect(hits.map((h) => [h.title, h.alias])).toEqual([['项目周会', 'Weekly Sync']]);
  });
  it('标题本身命中时不标别名；别名整段相等排在标题只是包含的前面', () => {
    expect(rankNotes(notes, '周会')[0]).toMatchObject({ title: '项目周会', alias: undefined });
    expect(rankNotes(notes, '例会').map((h) => [h.title, h.alias])).toEqual([['项目周会', '例会'], ['例会须知', undefined]]);
  });
});

describe('folderOf', () => {
  it('相对笔记库根目录；根目录下为空串；库外文件给出完整目录', () => {
    expect(folderOf('/lib/a/b/c.md', '/lib')).toBe('a/b');
    expect(folderOf('/lib/c.md', '/lib/')).toBe('');
    expect(folderOf('/elsewhere/c.md', '/lib')).toBe('/elsewhere');
  });
});
