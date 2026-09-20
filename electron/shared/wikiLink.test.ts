import { describe, expect, it } from 'vitest';
import { parseWikiTarget, resolveWikiTarget, matchesNoteName, noteNames, findHeadingIndex, linkifyMention } from './wikiLink';

const notes = [
  { path: '/lib/周会.md', title: '周会', aliases: [] },
  { path: '/lib/项目/周会.md', title: '项目周会', aliases: ['例会', 'Weekly'] },
  { path: '/lib/csharp.md', title: 'C# 入门', aliases: [] },
];

describe('parseWikiTarget', () => {
  it('拆出笔记名、逐级小节、块 ID，去掉扩展名', () => {
    expect(parseWikiTarget('笔记')).toEqual({ note: '笔记', headings: [], block: null });
    expect(parseWikiTarget('笔记.md#小节')).toEqual({ note: '笔记', headings: ['小节'], block: null });
    expect(parseWikiTarget('笔记#一级#二级')).toEqual({ note: '笔记', headings: ['一级', '二级'], block: null });
    expect(parseWikiTarget('笔记#^abc123')).toEqual({ note: '笔记', headings: [], block: 'abc123' });
    expect(parseWikiTarget('#本篇小节')).toEqual({ note: '', headings: ['本篇小节'], block: null });
  });
});

describe('resolveWikiTarget', () => {
  it('文件名、一级标题、别名都能命中，不区分大小写', () => {
    expect(resolveWikiTarget(notes, '项目周会').hit?.path).toBe('/lib/项目/周会.md');
    expect(resolveWikiTarget(notes, '例会').hit?.path).toBe('/lib/项目/周会.md');
    expect(resolveWikiTarget(notes, 'weekly').hit?.path).toBe('/lib/项目/周会.md');
    expect(resolveWikiTarget(notes, '不存在').hit).toBeNull();
  });

  it('带小节的链接命中笔记，小节单独给出（以前会整串当笔记名）', () => {
    const r = resolveWikiTarget(notes, '例会#待办#本周');
    expect(r.hit?.path).toBe('/lib/项目/周会.md');
    expect(r.headings).toEqual(['待办', '本周']);
  });

  it('同名时优先当前目录；路径写法按路径结尾比对', () => {
    expect(resolveWikiTarget(notes, '周会', '/lib/项目').hit?.path).toBe('/lib/项目/周会.md');
    expect(resolveWikiTarget(notes, '周会', '/lib').hit?.path).toBe('/lib/周会.md');
    expect(resolveWikiTarget(notes, '项目/周会', '/lib').hit?.path).toBe('/lib/项目/周会.md');
    expect(matchesNoteName(notes[0], '目/周会')).toBe(false); // 不能从目录名中间截
  });

  it('标题本身带 # 的笔记不会被拆成「笔记 + 小节」', () => {
    const r = resolveWikiTarget(notes, 'C# 入门');
    expect(r.hit?.path).toBe('/lib/csharp.md');
    expect(r.headings).toEqual([]);
  });

  it('[[#小节]] 指向本篇：没有笔记名，不去库里找', () => {
    expect(resolveWikiTarget(notes, '#待办')).toMatchObject({ note: '', headings: ['待办'], hit: null });
  });

  it('noteNames 去重', () => {
    expect(noteNames({ path: '/lib/周会.md', title: '周会', aliases: ['周会', '例会'] })).toEqual(['周会', '例会']);
  });
});

describe('findHeadingIndex', () => {
  const headings = [
    { level: 1, text: '周会' },
    { level: 2, text: '上周' },
    { level: 3, text: '待办' },
    { level: 2, text: '本周' },
    { level: 3, text: '待办' },
    { level: 2, text: 'Q&A: 问题' },
  ];
  it('单级取第一次出现的；多级逐级往下找，找到的是那一级下面的', () => {
    expect(findHeadingIndex(headings, ['待办'])).toBe(2);
    expect(findHeadingIndex(headings, ['本周', '待办'])).toBe(4);
    expect(findHeadingIndex(headings, ['上周', '待办'])).toBe(2);
  });
  it('紧跟在上一级后面的同级标题不算它的下级', () => {
    expect(findHeadingIndex([{ level: 2, text: 'A' }, { level: 2, text: 'B' }], ['A', 'B'])).toBe(1); // 逐级对不上，退回按名字找
    expect(findHeadingIndex([{ level: 2, text: 'A' }, { level: 2, text: 'X' }, { level: 3, text: 'B' }], ['A', 'B'])).toBe(2);
  });
  it('忽略大小写和链接里会被吞掉的符号；找不到返回 -1', () => {
    expect(findHeadingIndex(headings, ['q&a 问题'])).toBe(5);
    expect(findHeadingIndex(headings, ['没有'])).toBe(-1);
    expect(findHeadingIndex(headings, [])).toBe(-1);
  });
});

describe('linkifyMention', () => {
  const text = '今天做了苹果派，很好吃。';
  it('和文件名一样写成 [[名字]]，否则写成 [[文件名|原来的字]]', () => {
    expect(linkifyMention(text, 4, 3, '苹果派', '苹果派')).toBe('今天做了[[苹果派]]，很好吃。');
    expect(linkifyMention(text, 4, 3, '苹果派', 'apple-pie')).toBe('今天做了[[apple-pie|苹果派]]，很好吃。');
    expect(linkifyMention('Made a PIE today', 7, 3, 'PIE', 'pie')).toBe('Made a [[PIE]] today');
  });
  it('位置上的字对不上（那篇被改过）就不动', () => {
    expect(linkifyMention('前面加了字，' + text, 4, 3, '苹果派', '苹果派')).toBeNull();
    expect(linkifyMention(text, 40, 3, '苹果派', '苹果派')).toBeNull();
    expect(linkifyMention(text, -1, 3, '苹果派', '苹果派')).toBeNull();
  });
  // 偏移一律现算：手数错了的话，「应为 null」的断言会因为字对不上而误通过，测不到想测的分支
  const at = (content: string, word = '苹果派') => linkifyMention(content, content.lastIndexOf(word), word.length, word, '苹果派');
  it('已经在 [[ ]] 里的不再套一层；上一行没闭合的 [[ 不影响这一行', () => {
    expect(at('见 [[苹果派]]')).toBeNull();
    expect(at('见 [[食谱|苹果派做法]]')).toBeNull();
    expect(at('没闭合 [[\n苹果派')).toBe('没闭合 [[\n[[苹果派]]');
    expect(at('[[别的]] 之后的苹果派')).toBe('[[别的]] 之后的[[苹果派]]');
    // 对照：同样的写法、不在链接里时是会改的——上面两条 null 确实来自「已在链接里」
    expect(at('见 苹果派]]')).toBe('见 [[苹果派]]]]');
  });
});
