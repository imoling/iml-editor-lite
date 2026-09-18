import { describe, expect, it, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../components/Editor/editorExtensions';
import { markdownToHtml } from './markdown';
import { serializeDoc } from './incrementalMarkdown';

/**
 * 保真度：别的工具（Obsidian / Typora / GitHub）写的笔记，在富文本模式里打开、编辑、保存，
 * 没碰过的部分必须逐字不变。走的是真实管线：Markdown → HTML → Tiptap 文档 → Markdown。
 */
let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const throughEditor = (md: string) => {
  editor?.destroy();
  editor = new Editor({ extensions: editorExtensions, content: markdownToHtml(md) });
  return serializeDoc(editor).markdown;
};

const IDENTICAL: [string, string][] = [
  ['frontmatter（含注释）', '---\ntitle: 测试\ntags: [a, b]\n# 注释\n---\n\n# 标题\n\n正文'],
  ['提示块', '> [!NOTE]\n> 这是提示\n> 第二行'],
  ['提示块：小写类型 + 折叠标记 + 标题 + 多段', '> [!warning]- 折叠标题\n> 内容 **粗体**\n>\n> - 列表'],
  ['#标签 与层级标签', '正文 #标签 和 #项目/子项 结束'],
  ['删除线', '这是 ~~删除线~~ 文本'],
  ['下划线', '这是 <u>下划线</u> 文本'],
  ['标记之间的加号、减号、大于号', '按 <kbd>⌘</kbd> + <kbd>S</kbd>，**甲** - 乙，*丙* > 丁，`a` 1. b'],
  ['kbd / sub / sup', '按 <kbd>⌘</kbd>+<kbd>S</kbd> 保存，H<sub>2</sub>O，x<sup>2</sup>'],
  ['==高亮== 与 <mark>', '这是 ==高亮== 和 <mark>标记</mark>'],
  ['下划线变量名', '变量 my_var_name 和 file_name.md'],
  ['字面方括号', '引用 [1] 和 [注] 以及 a[0]'],
  ['脚注', '正文[^1] 和[^note]\n\n[^1]: 脚注内容\n[^note]: 第二条\n    续行'],
  ['行内公式', '行内公式 $x_{1} * y_2 + \\{a\\}$ 结束，$$E=mc^2$$'],
  ['HTML 注释', '前\n\n<!-- 注释 -->\n\n后'],
  ['<details>', '<details>\n<summary>标题</summary>\n\n内容\n\n</details>'],
  ['表格对齐', '| 左 | 中 | 右 |\n| --- | :-: | --: |\n| a | b | c |'],
  ['链接标题', '[链接](https://a.b "标题")'],
  ['自动链接与裸链接', '<https://example.com> 和 https://bare.example.com 结束'],
  ['嵌套列表', '- 甲\n  - 甲一\n    - 甲一一\n- 乙'],
  ['有序列表起始编号 + 子列表', '3. 三\n4. 四\n   - 子'],
  ['单个换行', '第一行\n第二行'],
  ['带宽度的 <img>', '<img src="assets/a.png" width="300">'],
  ['路径带空格的图片（Typora 写法）', '![图](图片/截图 1.png)'],
  ['中文路径的链接与图片', '[笔记](笔记/我的笔记.md) ![图](图片/截图.png)'],
  ['带链接的徽章图', '[![构建](https://img.shields.io/a.svg)](https://ci.example.com) [![版本](b.svg)](https://npm.example.com)'],
  ['连续两行图片', '![a](a.png)\n![b](b.png)'],
  ['标题里的图片', '## 标题 ![图标](i.png)'],
  ['带样式的 <span>', '这是 <span style="color:red">红字</span> 文本'],
  ['乘号与斜体', '2 * 3 * 4 和 *斜体*'],
  ['Windows 路径', '路径 C:\\Users\\me'],
  ['[TOC]', '[TOC]\n\n# 一'],
  ['嵌套任务', '- [ ] 父\n  - [x] 子\n  - [ ] 子二\n- [x] 完成'],
  ['多段引用', '> 第一段\n>\n> 第二段'],
  ['分割线', '前\n\n---\n\n后'],
  ['双链与嵌入', '![[图片.png]] 和 [[笔记#小节|别名]]'],
  ['应用协议链接', '[打开](obsidian://open?vault=x&file=y)'],
  ['普通项与任务项混排', '- 普通\n- [ ] 任务\n- 普通二'],
  ['列表项里的代码块（含空行）', '- 项目\n\n  ```js\n  const a = 1;\n\n  const b = 2;\n  ```'],
  ['<details> 里包着 Mermaid', '<details>\n\n```mermaid\ngraph TD\nA-->B\n```\n\n</details>'],
];

describe('富文本往返：逐字不变', () => {
  it.each(IDENTICAL)('%s', (_name, md) => {
    expect(throughEditor(md)).toBe(md);
  });
});

describe('富文本往返：有意的规范化', () => {
  it('找不到配对的尖括号标签当成文字保留，并转义成 \\<（否则别的工具会把它当 HTML 吞掉）', () => {
    const out = throughEditor('泛型 List<String> 和 a < b');
    expect(out).toBe('泛型 List\\<String> 和 a < b');
    expect(throughEditor(out)).toBe(out);
  });

  it('不合法的链接写法（地址带空格又没用 <> 包）保持字面文字', () => {
    const out = throughEditor('[中文](笔记/我的 笔记.md)');
    expect(out).toBe('\\[中文\\](笔记/我的 笔记.md)');
    expect(throughEditor(out)).toBe(out);
  });

  it('frontmatter 前面被插进内容时，保存仍把它放回文件开头', () => {
    editor = new Editor({ extensions: editorExtensions, content: markdownToHtml('---\na: 1\n---\n\n正文') });
    editor.commands.insertContentAt(0, '<p>跑到前面的段落</p>');
    expect(serializeDoc(editor).markdown).toBe('---\na: 1\n---\n\n跑到前面的段落\n\n正文');
  });
});

describe('预览 / 导出渲染', () => {
  it('frontmatter 渲染成属性卡片，不再是分割线 + 标题', () => {
    const html = markdownToHtml('---\ntitle: 测试\ntags: [a, b]\n---\n\n正文', true);
    expect(html).toContain('frontmatter-card');
    expect(html).not.toContain('<hr');
    expect(html).not.toContain('<h2');
    expect(html).toContain('<span class="frontmatter-card__chip">a</span>');
  });

  it('提示块带标题栏，[TOC] 生成目录，标签渲染成芯片，行内公式走 KaTeX', () => {
    const html = markdownToHtml('[TOC]\n\n# 一\n\n## 二\n\n> [!TIP] 小技巧\n> 内容\n\n#标签 $a^2$', true);
    expect(html).toContain('class="callout callout--tip"');
    expect(html).toContain('<div class="callout__title">小技巧</div>');
    expect(html).toContain('data-toc-index="1"');
    expect(html).toContain('id="toc-heading-0"');
    expect(html).toContain('<span class="tag-chip" data-tag="标签">#标签</span>');
    expect(html).toContain('class="katex');
  });

  it('脚注渲染成上标与脚注区，不再变成乱码链接', () => {
    const html = markdownToHtml('正文[^1]\n\n[^1]: 脚注 **内容**', true);
    expect(html).toContain('<sup class="footnote-ref">1</sup>');
    expect(html).toContain('<div class="footnote-def"><sup>1</sup> 脚注 <strong>内容</strong></div>');
    expect(html).not.toContain('<a ');
  });

  it('任务列表在预览里带只读勾选框（嵌套的也有）', () => {
    const html = markdownToHtml('- [x] 完成\n- [ ] 未完成\n  - [x] 子任务', true);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const boxes = Array.from(doc.querySelectorAll('li[data-type="taskItem"] > label > input[type="checkbox"]'));
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.hasAttribute('checked'))).toEqual([true, false, true]);
    expect(boxes.every((b) => b.hasAttribute('disabled'))).toBe(true);
    // 富文本那一路不加（编辑器自己画）
    expect(markdownToHtml('- [x] 完成')).not.toContain('<input');
  });

  it('代码里的 #、$、== 不被当成标签 / 公式 / 高亮', () => {
    const html = markdownToHtml('`#不是标签 $x$ ==y==`\n\n```\n#也不是\n```', true);
    expect(html).not.toContain('tag-chip');
    expect(html).not.toContain('katex');
    expect(html).not.toContain('<mark');
  });
});
