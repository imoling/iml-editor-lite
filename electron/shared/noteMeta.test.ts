import { describe, expect, it } from 'vitest';
import {
  splitFrontmatter, buildFrontmatterBlock, frontmatterYaml, parseFrontmatter,
  findTags, matchTagAt, extractTags, frontmatterTags, tagMatches, stripNonProse,
  calloutKind, calloutLabel, CALLOUT_HEAD_RE,
} from './noteMeta';

describe('splitFrontmatter', () => {
  it('拆出 frontmatter 原文与正文，并给出行号偏移', () => {
    const md = '---\ntitle: 测试\ntags: [a, b]\n---\n\n# 标题\n正文';
    const r = splitFrontmatter(md);
    expect(r.block).toBe('---\ntitle: 测试\ntags: [a, b]\n---');
    expect(r.yaml).toBe('title: 测试\ntags: [a, b]');
    expect(r.body).toBe('# 标题\n正文');
    expect(r.lineOffset).toBe(5);
    expect(md.split('\n')[r.lineOffset]).toBe('# 标题');
  });

  it('没有 frontmatter、或开头只是一条分割线时原样返回', () => {
    expect(splitFrontmatter('# 标题').block).toBeNull();
    const hr = '---\n\n这是正文，不是 YAML\n\n---\n\n后面';
    expect(splitFrontmatter(hr)).toMatchObject({ block: null, body: hr, lineOffset: 0 });
    expect(splitFrontmatter('---\n没有结束线').block).toBeNull();
  });

  it('空 frontmatter、CRLF、... 结束线都认', () => {
    expect(splitFrontmatter('---\n---\n正文')).toMatchObject({ block: '---\n---', yaml: '', body: '正文' });
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\n正文')).toMatchObject({ yaml: 'a: 1', body: '正文' });
    expect(splitFrontmatter('---\na: 1\n...\n正文').body).toBe('正文');
  });

  it('YAML 原文里的注释、缩进、引号一个字符都不动', () => {
    const yaml = '# 注释\ntitle:   "带 空格"\nlist:\n    - x   # 行尾注释\nnested:\n  a: {b: 1}';
    const md = `---\n${yaml}\n---\n正文`;
    expect(splitFrontmatter(md).yaml).toBe(yaml);
    expect(frontmatterYaml(buildFrontmatterBlock(yaml))).toBe(yaml);
  });
});

describe('parseFrontmatter', () => {
  it('标量、行内列表、块列表', () => {
    expect(parseFrontmatter('title: "你好"\ntags: [a, "b c"]\naliases:\n  - 甲\n  - 乙\ndate: 2026-09-18')).toEqual([
      { key: 'title', value: '你好' },
      { key: 'tags', value: ['a', 'b c'] },
      { key: 'aliases', value: ['甲', '乙'] },
      { key: 'date', value: '2026-09-18' },
    ]);
  });

  it('嵌套对象按字符串显示，不抛错', () => {
    const fields = parseFrontmatter('meta:\n  a: 1\n  b: 2');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual({ key: 'meta', value: 'a: 1\nb: 2' });
  });
});

describe('标签', () => {
  it('行首、空白、中文标点后的 #xxx 才是标签', () => {
    expect(findTags('#工作 今天 #项目/子项，#跟进。').map((t) => t.tag)).toEqual(['工作', '项目/子项', '跟进']);
    expect(findTags('见 C#语言、issue #123、颜色 #6366F1 #fff0 #f0f')).toEqual([{ from: 29, to: 34, tag: 'fff0' }]);
    expect(findTags('https://a.com/#section 和 [锚点](#anchor)')).toEqual([]);
    expect(findTags('# 标题不是标签')).toEqual([]);
  });

  it('位置指向 # 号，末尾的 - 和 / 不算在内', () => {
    expect(findTags('a #tag- b')).toEqual([{ from: 2, to: 6, tag: 'tag' }]);
    expect(findTags('#a #b')).toEqual([{ from: 0, to: 2, tag: 'a' }, { from: 3, to: 5, tag: 'b' }]);
  });

  it('matchTagAt 按前一个字符判断边界', () => {
    expect(matchTagAt('#工作 后面', '')).toBe('工作');
    expect(matchTagAt('#工作', ' ')).toBe('工作');
    expect(matchTagAt('#工作', '，')).toBe('工作');
    expect(matchTagAt('#工作', '字')).toBeNull();
    expect(matchTagAt('#123', ' ')).toBeNull();
    expect(matchTagAt('工作', ' ')).toBeNull();
  });

  it('extractTags 合并 frontmatter 与正文，跳过代码和链接地址，大小写不敏感去重', () => {
    const md = [
      '---', 'tags: [读书, "#Work"]', '---', '',
      '正文 #work #想法', '',
      '```', '#不是标签', '```', '',
      '行内 `#也不是` [链接](https://x.y/#frag) [[笔记#小节]]',
    ].join('\n');
    expect(extractTags(md)).toEqual(['读书', 'Work', '想法']);
  });

  it('frontmatter 的 tags 支持逗号 / 空格分隔的字符串与块列表', () => {
    expect(frontmatterTags('tags: a, b c')).toEqual(['a', 'b', 'c']);
    expect(frontmatterTags('tag: 单个')).toEqual(['单个']);
    expect(frontmatterTags('tags:\n  - x/y\n  - z')).toEqual(['x/y', 'z']);
  });

  it('tagMatches：选中父标签时子标签也算', () => {
    expect(tagMatches('项目/子项', '项目')).toBe(true);
    expect(tagMatches('项目', '项目')).toBe(true);
    expect(tagMatches('项目组', '项目')).toBe(false);
    expect(tagMatches('Work', 'work')).toBe(true);
  });

  it('stripNonProse 去掉未闭合的围栏代码', () => {
    expect(stripNonProse('前\n```js\n#x\n')).not.toContain('#x');
  });
});

describe('提示块', () => {
  it('类型归并到五种配色，标准类型给中文名，其余保留原名', () => {
    expect(calloutKind('NOTE')).toBe('note');
    expect(calloutKind('danger')).toBe('caution');
    expect(calloutKind('whatever')).toBe('note');
    expect(calloutLabel('WARNING')).toBe('警告');
    expect(calloutLabel('bug')).toBe('bug');
    expect(calloutLabel('tip', ' 自定义 ')).toBe('自定义');
  });

  it('首行正则：类型、折叠标记、标题', () => {
    expect(CALLOUT_HEAD_RE.exec('[!NOTE]')?.slice(1, 4)).toEqual(['NOTE', '', '']);
    expect(CALLOUT_HEAD_RE.exec('[!tip]- 折叠的标题')?.slice(1, 4)).toEqual(['tip', '-', '折叠的标题']);
    expect(CALLOUT_HEAD_RE.exec('[普通] 文本')).toBeNull();
  });
});
