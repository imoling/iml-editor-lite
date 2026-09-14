import { describe, expect, it } from 'vitest';
import { markdownToHtml, htmlToMarkdown } from './markdown';

const roundTrip = (md: string) => htmlToMarkdown(markdownToHtml(md));

describe('markdownToHtml', () => {
  it('代码块与行内代码里的 HTML 必须转义，不能变成真标签', () => {
    const html = markdownToHtml('```html\n<img src=x onerror=alert(1)>\n```\n\n行内 `<script>` 代码');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('mermaid / svg 代码块编码进 data-code，不进 <pre>', () => {
    const html = markdownToHtml('```mermaid\ngraph TD\nA-->B\n```');
    expect(html).toContain('data-mermaid-block');
    expect(html).toContain('data-code="base64:');
    expect(html).not.toContain('<pre>');
  });

  it('普通项和任务项混在一个列表里时拆成两个列表', () => {
    const html = markdownToHtml('- 普通一\n- 普通二\n- [x] 任务');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lists = Array.from(doc.querySelectorAll('ul'));
    expect(lists).toHaveLength(2);
    expect(lists[0].getAttribute('data-type')).toBeNull();
    expect(lists[0].querySelectorAll('li')).toHaveLength(2);
    expect(lists[1].getAttribute('data-type')).toBe('taskList');
    // 往返稳定
    const once = roundTrip('- 普通一\n- 普通二\n- [x] 任务');
    expect(roundTrip(once)).toBe(once);
  });

  it('$$ 公式块转成 math 节点，预览模式用 KaTeX 渲染', () => {
    expect(markdownToHtml('$$\ne = mc^2\n$$')).toContain('data-latex="e = mc^2"');
    expect(markdownToHtml('$$\ne = mc^2\n$$', true)).toContain('class="katex');
    expect(htmlToMarkdown('<div class="math-block" data-latex="a &lt; b">a &lt; b</div>')).toBe('$$\na < b\n$$');
  });

  it('GFM 任务列表转成 Tiptap 的 taskList 结构', () => {
    const html = markdownToHtml('- [x] 完成\n- [ ] 未完成');
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
  });
});

describe('markdown ↔ html 往返', () => {
  it.each([
    ['标题与段落', '# 标题\n\n第一段\n\n## 二级\n\n第二段'],
    ['无序与有序列表', '- 甲\n- 乙\n\n1. 一\n2. 二'],
    ['加粗斜体链接', '这是 **粗体** 和 *斜体* 以及 [链接](https://example.com)'],
    ['引用', '> 引用一行'],
    ['围栏代码', '```js\nconst a = 1;\n```'],
    ['任务列表', '- [x] 完成\n- [ ] 未完成'],
    ['图片', '![图](assets/a.png)'],
    ['Mermaid 块', '```mermaid\ngraph TD\nA-->B\n```'],
    ['公式块', '$$\ne = mc^2\n$$'],
  ])('%s 往返后再转一次结果稳定', (_name, md) => {
    const once = roundTrip(md);
    const twice = roundTrip(once);
    expect(twice).toBe(once);
    expect(once.length).toBeGreaterThan(0);
  });

  it('表格往返保留表头与单元格', () => {
    const md = '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |';
    const out = roundTrip(md);
    expect(out).toContain('名称');
    expect(out).toContain('苹果');
    expect(out).toMatch(/\|\s*---/);
  });

  it('data URL 图片往返不丢', () => {
    const md = '![](data:image/png;base64,iVBORw0KGgo=)';
    expect(roundTrip(md)).toContain('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('双向链接 [[ ]]', () => {
  it('转成 data-wiki-link 芯片，代码里的不转，往返保持写法', () => {
    const html = markdownToHtml('见 [[苹果笔记]] 和 [[苹果笔记|别名]]，代码 `[[x]]`');
    expect(html).toContain('<span class="wiki-link" data-wiki-link="苹果笔记">苹果笔记</span>');
    expect(html).toContain('<span class="wiki-link" data-wiki-link="苹果笔记">别名</span>');
    expect(html).toContain('<code class="inline-code">[[x]]</code>');
    expect(roundTrip('见 [[苹果笔记]] 和 [[苹果笔记|别名]]')).toBe('见 [[苹果笔记]] 和 [[苹果笔记|别名]]');
  });
});
