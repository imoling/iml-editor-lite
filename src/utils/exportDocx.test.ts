import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { htmlToDocx } from './exportDocx';
import { markdownToStaticHtml } from './markdown';

// 1×1 的 PNG；真实环境里取图函数用 canvas，这里给个假的
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const loadImage = async (src: string) => (src.includes('缺失') ? null : { data: PNG, width: 1200, height: 600 });

async function build(md: string) {
  const html = await markdownToStaticHtml(md);
  const bytes = await htmlToDocx(html, { title: '测试', loadImage });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  // 把每个段落的纯文字拿出来，断言起来直观
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => ({ xml: m[0], text: [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('') }));
  return { zip, xml, paras, find: (t: string) => paras.find((p) => p.text.includes(t))! };
}

describe('导出 Word', () => {
  it('是一个能打开的 docx：必备的部件都在，标题、作者写进了属性', async () => {
    const { zip } = await build('# 标题\n\n正文');
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml']));
    expect(await zip.file('docProps/core.xml')!.async('string')).toContain('<dc:title>测试</dc:title>');
  });

  it('标题用 Word 自己的标题样式（能生成目录、能在导航窗格里看到）', async () => {
    const { find } = await build('# 一级\n\n## 二级\n\n### 三级');
    expect(find('一级').xml).toContain('w:val="Heading1"');
    expect(find('二级').xml).toContain('w:val="Heading2"');
    expect(find('三级').xml).toContain('w:val="Heading3"');
  });

  it('行内格式：加粗、斜体、删除线、行内代码、高亮、链接', async () => {
    const { find, zip } = await build('这是 **粗** 和 *斜* 和 ~~删~~ 和 `code` 和 ==亮== 和 [链接](https://example.com/a?b=1)。');
    const x = find('这是').xml;
    const runOf = (t: string) => [...x.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map((m) => m[0]).find((r) => r.includes(`>${t}<`))!;
    expect(runOf('粗')).toContain('<w:b/>');
    expect(runOf('斜')).toContain('<w:i/>');
    expect(runOf('删')).toContain('<w:strike/>');
    expect(runOf('code')).toContain('Consolas');
    expect(runOf('亮')).toContain('w:highlight');
    expect(runOf('这是 ')).not.toContain('<w:b/>');
    expect(x).toContain('<w:hyperlink');
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('https://example.com/a?b=1');
  });

  it('列表：无序用项目符号、有序用编号且嵌套有层级；第二个有序列表重新从 1 开始；任务列表带 ☑ / ☐', async () => {
    const { find, paras } = await build('- 甲\n  - 甲一\n\n1. 第一\n2. 第二\n\n隔开\n\n1. 另一个列表\n\n- [x] 做完\n- [ ] 没做');
    expect(find('甲一').xml).toMatch(/<w:ilvl w:val="1"\/>/);
    expect(find('甲').xml).toMatch(/<w:ilvl w:val="0"\/>/);
    const numId = (t: string) => /<w:numId w:val="(\d+)"\/>/.exec(find(t).xml)?.[1];
    expect(numId('第一')).toBe(numId('第二'));
    expect(numId('另一个列表')).not.toBe(numId('第一'));
    expect(paras.map((p) => p.text).filter((t) => /[☑☐]/.test(t))).toEqual(['☑ 做完', '☐ 没做']);
  });

  it('空白像浏览器那样折叠：相邻节点之间不会空两格，段首段尾没有多余空格；词与词之间的空格留着', async () => {
    const bytes = await htmlToDocx('<p>  前面 <strong> 加粗 </strong> <em>斜体</em>\n   后面  </p><p>hello <b>big</b> world</p>', { title: 't', loadImage });
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    const texts = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''));
    expect(texts).toEqual(['前面 加粗 斜体 后面 ', 'hello big world']);
  });

  it('表格：行列对得上，表头加粗，对齐方式保留', async () => {
    const { xml } = await build('| 名称 | 数量 |\n| :-- | --: |\n| 苹果 | 3 |\n| 梨 | 12 |');
    expect((xml.match(/<w:tr[ >]/g) || []).length).toBe(3);
    expect((xml.match(/<w:tc>/g) || []).length).toBe(6);
    const header = /<w:tr[ >][\s\S]*?<\/w:tr>/.exec(xml)![0];
    expect(header).toContain('<w:b/>');
    expect(xml).toMatch(/<w:jc w:val="right"\/>[\s\S]*?>12</);
  });

  it('代码块逐行保留（含空行和缩进）；引用带左边线；分割线', async () => {
    const { paras, find } = await build('```js\nconst a = 1;\n\n  indent();\n```\n\n> 引用的话\n\n---\n\n结尾');
    const code = paras.filter((p) => p.xml.includes('Consolas'));
    expect(code.map((p) => p.text)).toEqual(['const a = 1;', ' ', '  indent();']);
    expect(find('引用的话').xml).toContain('<w:left ');
    expect(paras.some((p) => p.xml.includes('<w:bottom ') && !p.text)).toBe(true);
  });

  it('图片嵌进文件里，超宽的按页面宽度等比缩小；取不到的图留一行说明，不让整个导出失败', async () => {
    const { zip, xml, find } = await build('![示意](a.png)\n\n![没了](缺失.png)');
    expect(Object.keys(zip.files).some((f) => /^word\/media\/.+\.png$/.test(f))).toBe(true);
    // 1200×600 → 560×280，单位 EMU（1 像素 = 9525）
    expect(xml).toContain(`cx="${560 * 9525}"`);
    expect(xml).toContain(`cy="${280 * 9525}"`);
    expect(find('[图片：').text).toBe('[图片：没了]');
  });

  it('公式显示 LaTeX 原文；脚注、提示块、属性卡片', async () => {
    const { paras, find } = await build('---\ntags: [a]\n---\n\n行内 $E=mc^2$ 公式[^1]\n\n$$\n\\sum_{i=1}^n i\n$$\n\n> [!WARNING] 小心\n> 提示内容\n\n[^1]: 脚注文字');
    expect(find('行内').text).toContain('$E=mc^2$');
    expect(paras.some((p) => p.text.includes('$$ \\sum_{i=1}^n i $$'))).toBe(true);
    expect(find('提示内容').xml).toContain('<w:left ');
    expect(find('脚注文字')).toBeDefined();
    expect(paras.some((p) => p.text.includes('tags'))).toBe(false);   // 属性卡片不进正文，和导出 PDF 一致
    expect(paras.some((p) => p.text.includes('↩'))).toBe(false);
  });

  it('中文正文指定了东亚字体（不然 WPS / Word 里中文会回落成宋体）', async () => {
    const { zip } = await build('中文');
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('w:eastAsia="Microsoft YaHei"');
  });

  it('空文档也能导出', async () => {
    const bytes = await htmlToDocx('', { title: '空', loadImage });
    expect((await JSZip.loadAsync(bytes)).file('word/document.xml')).not.toBeNull();
  });
});
