import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import { escapeMarkdown } from './markdownEscape';

describe('escapeMarkdown：不需要转义的不动', () => {
  it.each([
    ['变量 my_var_name 和 file_name.md'],
    ['中文_之间_的下划线'],
    ['引用 [1] 和 [注] 以及 a[0]'],
    ['路径 C:\\Users\\me'],
    ['2 * 3 * 4'],
    ['a < b 且 c > d'],
    ['AT&T'],
    ['#标签 和 C# 以及 -5 度'],
    ['行内公式 $x_{1} * y_2 \\{a\\}$ 结束'],
    ['价格 $5 和 $10'],
    ['波浪线 ~ 约等于'],
  ])('%s', (text) => {
    expect(escapeMarkdown(text)).toBe(text);
  });
});

describe('escapeMarkdown：会被解析成语法的才转义', () => {
  it.each([
    ['*强调*', '\\*强调\\*'],
    ['_斜体_ 开头', '\\_斜体\\_ 开头'],
    ['`代码`', '\\`代码\\`'],
    ['[文字](https://a.b)', '\\[文字\\](https://a.b)'],
    ['[文字][ref]', '\\[文字\\]\\[ref\\]'],
    ['[ ] 像任务', '\\[ \\] 像任务'],
    ['泛型 List<String>', '泛型 List\\<String>'],
    ['<!-- 注释 -->', '\\<!-- 注释 -->'],
    ['&copy; 实体', '\\&copy; 实体'],
    ['字面 \\* 星号', '字面 \\\\\\* 星号'],
    ['~~删除~~', '\\~\\~删除\\~\\~'],
    ['- 像列表', '\\- 像列表'],
    ['---', '\\---'],
    ['1. 像编号', '1\\. 像编号'],
    ['# 像标题', '\\# 像标题'],
    ['> 像引用', '\\> 像引用'],
    ['===', '\\==='],
  ])('%s', (text, expected) => {
    expect(escapeMarkdown(text)).toBe(expected);
  });
});

describe('escapeMarkdown：转义后的文本经 Markdown 解析还原成原文', () => {
  const md = new Marked({ gfm: true });
  const decode = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim();

  it.each([
    ['*强调* 和 _斜体_ 以及 `代码`'],
    ['[文字](doc.md) 与 ![图](x.png)'],
    ['泛型 List<String> 和 <!-- 注释 -->'],
    ['my_var 和 [1] 和 C:\\Users\\me'],
    ['- 像列表'],
    ['1. 像编号'],
    ['# 像标题'],
    ['> 像引用'],
    ['---'],
    ['~~删除~~ 与 &copy;'],
    ['字面 \\* 星号与结尾反斜杠\\'],
  ])('%s', (text) => {
    const html = md.parse(escapeMarkdown(text), { async: false }) as string;
    expect(html).not.toMatch(/<(em|strong|code|a|img|ul|ol|h1|blockquote|hr|del)\b/);
    expect(decode(html)).toBe(text);
  });
});
