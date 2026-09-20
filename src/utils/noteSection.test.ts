import { describe, expect, it } from 'vitest';
import { extractNoteSection, hideBlockIds } from './noteSection';

const NOTE = [
  '---', 'tags: [会议]', '---', '',
  '# 周会', '', '开场。', '',
  '## 上周', '', '上周的事。', '', '### 待办', '', '- 旧的待办', '',
  '## 本周', '', '本周的事。 ^this-week', '', '### 待办', '', '- 新的待办', '',
  '```', '## 代码里的不是标题', '```', '',
  '| a | b |', '| - | - |', '| 1 | 2 |', '', '^tbl', '',
  '## 结尾', '', '完。',
].join('\n');

describe('extractNoteSection', () => {
  it('没指定小节：去掉 frontmatter 的全文', () => {
    const body = extractNoteSection(NOTE, { headings: [], block: null })!;
    expect(body.startsWith('# 周会')).toBe(true);
    expect(body).not.toContain('tags:');
  });

  it('#小节：到下一个同级或更高级标题之前，子小节和代码块都带上', () => {
    const s = extractNoteSection(NOTE, { headings: ['本周'], block: null })!;
    expect(s.startsWith('## 本周')).toBe(true);
    expect(s).toContain('- 新的待办');
    expect(s).toContain('## 代码里的不是标题'); // 代码块里的 ## 不会把小节截断
    expect(s).toContain('| 1 | 2 |');
    expect(s).not.toContain('## 结尾');
    expect(s).not.toContain('旧的待办');
  });

  it('#一级#二级：同名小节取对的那个；最后一节一直到文末', () => {
    expect(extractNoteSection(NOTE, { headings: ['上周', '待办'], block: null })).toBe('### 待办\n\n- 旧的待办');
    expect(extractNoteSection(NOTE, { headings: ['本周', '待办'], block: null })!.startsWith('### 待办\n\n- 新的待办')).toBe(true);
    expect(extractNoteSection(NOTE, { headings: ['结尾'], block: null })).toBe('## 结尾\n\n完。');
  });

  it('#^块：取那一段，块 ID 不显示；块 ID 单独一行时标的是上面那一块', () => {
    expect(extractNoteSection(NOTE, { headings: [], block: 'this-week' })).toBe('本周的事。');
    expect(extractNoteSection(NOTE, { headings: [], block: 'tbl' })).toBe('| a | b |\n| - | - |\n| 1 | 2 |');
  });

  it('找不到返回 null，而不是悄悄给全文；块 ID 不做前缀匹配', () => {
    expect(extractNoteSection(NOTE, { headings: ['没有这一节'], block: null })).toBeNull();
    expect(extractNoteSection(NOTE, { headings: [], block: 'nope' })).toBeNull();
    expect(extractNoteSection(NOTE, { headings: [], block: 'this' })).toBeNull();
  });
});

describe('hideBlockIds', () => {
  it('行尾和单独一行的块标记藏起来；代码块里的、不像块标记的不动', () => {
    const md = ['一段话。 ^abc-1', '', '| a |', '| - |', '', '^tbl', '', '```', 'x = y ^keep', '```', '', '2 ^ 3 和 a^b 不是块标记', '结尾^'].join('\n');
    expect(hideBlockIds(md)).toBe(['一段话。', '', '| a |', '| - |', '', '', '', '```', 'x = y ^keep', '```', '', '2 ^ 3 和 a^b 不是块标记', '结尾^'].join('\n'));
  });
});
