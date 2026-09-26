import { describe, expect, it } from 'vitest';
import { readProps, setProp, removeProp, renameProp, isValidPropKey } from './frontmatterEdit';

const YAML = [
  '# 这是注释，别动',
  'title: "项目周会：第 3 期"',
  'tags: [会议, "带,逗号", 读书]',
  'aliases:',
  '    - 例会',
  "    - 'Weekly Sync'",
  '',
  'date: 2026-09-20   # 开会那天',
  'done: false',
  'rating: 4.5',
  'author:',
  '  name: 张三',
  '  mail: a@b.c',
  'summary: |',
  '  第一行',
  '',
  '  第三行',
  'empty:',
  'status: 进行中',
].join('\n');

const kinds = (y: string) => Object.fromEntries(readProps(y).map((f) => [f.key, f.kind]));
const valueOf = (y: string, k: string) => readProps(y).find((f) => f.key === k)?.value;

describe('readProps', () => {
  it('认出每个字段的类型；嵌套对象、多行字符串标成 complex', () => {
    expect(kinds(YAML)).toEqual({ title: 'text', tags: 'list', aliases: 'list', date: 'date', done: 'checkbox', rating: 'number', author: 'complex', summary: 'complex', empty: 'text', status: 'text' });
  });
  it('值去掉了引号和行尾注释；行内列表里引号包着的逗号不拆', () => {
    expect(valueOf(YAML, 'title')).toBe('项目周会：第 3 期');
    expect(valueOf(YAML, 'tags')).toEqual(['会议', '带,逗号', '读书']);
    expect(valueOf(YAML, 'aliases')).toEqual(['例会', 'Weekly Sync']);
    expect(valueOf(YAML, 'date')).toBe('2026-09-20');
    expect(valueOf(YAML, 'done')).toBe(false);
    expect(valueOf(YAML, 'empty')).toBe('');
  });
  it('带引号的值、行内列表后面的注释也认；引号里的 # 不是注释', () => {
    const y = 'a: "说 #1 好"   # 注一\nb: [x, "y #z"]  # 注二\nc: \'it\'\'s #ok\' # 注三';
    expect(readProps(y).map((f) => f.value)).toEqual(['说 #1 好', ['x', 'y #z'], "it's #ok"]);
    expect(setProp(y, 'a', '改了')).toContain('a: "改了"   # 注一');
    expect(setProp(y, 'b', ['x'])).toContain('b: [x]  # 注二');
  });

  it('字段占的行范围：块列表、嵌套对象、带空行的多行字符串都算全', () => {
    const range = (k: string) => { const f = readProps(YAML).find((x) => x.key === k)!; return [f.from, f.to]; };
    expect(range('aliases')).toEqual([3, 5]);
    expect(range('author')).toEqual([10, 12]);
    expect(range('summary')).toEqual([13, 16]);
  });
  it('tags / aliases 写成一个字符串时也当列表；加了引号的 true、数字是文本', () => {
    expect(valueOf('tags: 会议, 读书 #想法', 'tags')).toEqual(['会议', '读书', '想法']);
    expect(valueOf('alias: 例会, Weekly Sync', 'alias')).toEqual(['例会', 'Weekly Sync']);
    expect(kinds('a: "true"\nb: "42"\nc: yes')).toEqual({ a: 'text', b: 'text', c: 'text' });
  });
  it('列表项是对象的不拆，整个字段 complex', () => {
    expect(kinds('people:\n  - name: 张三\n  - name: 李四')).toEqual({ people: 'complex' });
  });
});

describe('setProp：只动那个字段的几行', () => {
  // 整串精确比对：除了指定的那处替换，其余（空行、注释、缩进）必须逐字节相同
  const only = (out: string, from: string, to: string) => { expect(YAML.includes(from)).toBe(true); expect(out).toBe(YAML.replace(from, to)); };

  it('改文本：原来的引号风格留着；别的行一个字符不动', () => {
    only(setProp(YAML, 'status', '已完成'), 'status: 进行中', 'status: 已完成');
    only(setProp(YAML, 'title', '新标题'), 'title: "项目周会：第 3 期"', 'title: "新标题"');
    only(setProp(YAML, 'empty', '有值了'), 'empty:', 'empty: 有值了');
  });
  it('改日期 / 勾选 / 数字：行尾注释连同前面的空格原样接回去', () => {
    only(setProp(YAML, 'date', '2026-10-01'), 'date: 2026-09-20   # 开会那天', 'date: 2026-10-01   # 开会那天');
    only(setProp(YAML, 'done', true), 'done: false', 'done: true');
    only(setProp(YAML, 'rating', '5'), 'rating: 4.5', 'rating: 5');
  });
  it('块列表还写成块列表，缩进和每项的引号风格照旧', () => {
    only(setProp(YAML, 'aliases', ['例会', 'Weekly Sync', '周会']), "    - 'Weekly Sync'\n", "    - 'Weekly Sync'\n    - 周会\n");
    only(setProp(YAML, 'aliases', ['Weekly Sync']), "    - 例会\n    - 'Weekly Sync'", "    - 'Weekly Sync'");
  });
  it('行内列表还写成行内；带逗号的项自动加引号；清空变成 []', () => {
    only(setProp(YAML, 'tags', ['会议', 'a, b']), 'tags: [会议, "带,逗号", 读书]', 'tags: [会议, "a, b"]');
    only(setProp(YAML, 'tags', []), 'tags: [会议, "带,逗号", 读书]', 'tags: []');
    only(setProp(YAML, 'aliases', []), "aliases:\n    - 例会\n    - 'Weekly Sync'", 'aliases: []');
  });
  it('会被 YAML 读成别的东西的文本自动加引号：数字、true、带冒号空格、# 号', () => {
    expect(setProp('k: x', 'k', '007')).toBe('k: "007"');
    expect(setProp('k: x', 'k', 'true')).toBe('k: "true"');
    expect(setProp('k: x', 'k', 'a: b')).toBe('k: "a: b"');
    expect(setProp('k: x', 'k', '说 "你好" #1')).toBe('k: "说 \\"你好\\" #1"');
    expect(readProps(setProp('k: x', 'k', '说 "你好" #1'))[0].value).toBe('说 "你好" #1');
    expect(setProp('k: x', 'k', '普通文字 没问题')).toBe('k: 普通文字 没问题');
  });
  it('没有这个字段就加在最后，末尾的空行留在后头；complex 字段不让改', () => {
    expect(setProp('a: 1\n\n', 'b', ['x'])).toBe('a: 1\nb: [x]\n\n');
    expect(setProp('', 'done', false)).toBe('done: false');
    // 空的文本属性写成 `key:`，不是 `key: ""`；把已有的值清空也一样（行尾注释留着）
    expect(setProp('a: 1', 'status', '')).toBe('a: 1\nstatus:');
    expect(setProp('title: "x"   # 注', 'title', '')).toBe('title:   # 注');
    expect(setProp('a: 1', 'due', '2026-10-01', 'date')).toBe('a: 1\ndue: 2026-10-01');
    expect(setProp(YAML, 'author', 'x')).toBe(YAML);
  });
  it('大小写不同算同一个字段；Windows 换行照旧', () => {
    expect(setProp('Tags: [a]', 'tags', ['a', 'b'])).toBe('Tags: [a, b]');
    expect(setProp('a: 1\r\nb: 2', 'a', '3')).toBe('a: 3\r\nb: 2');
  });
});

describe('removeProp / renameProp', () => {
  it('删字段连同它占的所有行；别的不动', () => {
    const out = removeProp(YAML, 'aliases');
    expect(out).not.toContain('例会');
    expect(out).toContain('tags: [会议, "带,逗号", 读书]\n\ndate:');
    expect(removeProp(YAML, 'summary')).toContain('  mail: a@b.c\nempty:');
    expect(removeProp(YAML, '没有')).toBe(YAML);
  });
  it('改名只动名字，值和后面的行不动；重名、不合法的名字返回 null', () => {
    expect(renameProp(YAML, 'aliases', '别名')).toContain("别名:\n    - 例会\n    - 'Weekly Sync'");
    expect(renameProp(YAML, 'date', '开会日期')).toContain('开会日期: 2026-09-20   # 开会那天');
    expect(renameProp(YAML, 'date', 'tags')).toBeNull();
    expect(renameProp(YAML, 'date', 'a: b')).toBeNull();
    expect(renameProp(YAML, 'date', '')).toBeNull();
    expect([isValidPropKey('开会 日期'), isValidPropKey('-x'), isValidPropKey(' x'), isValidPropKey('a#b')]).toEqual([true, false, false, false]);
  });
});
