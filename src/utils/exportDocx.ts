import type { Paragraph as DocxParagraph, Table as DocxTable, ParagraphChild, IParagraphOptions } from 'docx';

/**
 * 导出 Word（.docx）：把导出用的静态 HTML（和导出 PDF 用的是同一份）逐个元素翻译成 Word 的段落、列表、表格。
 *
 * 为什么不直接把 HTML 塞进 docx 让 Word 自己转（altChunk）：那种文件只有 Windows 上的 Word 认，
 * WPS、Pages、预览、手机上打开都是空白——而国内收文件的人多半用 WPS。
 * docx 这个库只在点了「导出为 Word」时才加载，不进主包。
 */
export interface DocxImage { data: Uint8Array; width: number; height: number }
export interface DocxOptions {
  title: string;
  /** 取图片：返回 PNG 的字节和像素尺寸；取不到返回 null（那张图在文档里换成一行说明）。浏览器里用 canvas 实现，测试里给假的 */
  loadImage: (src: string) => Promise<DocxImage | null>;
}

type Block = DocxParagraph | DocxTable;
interface Ctx {
  d: typeof import('docx');
  opts: DocxOptions;
  /** 每个 <ol> 一个编号实例：不然第二个有序列表会接着第一个的数往下数 */
  listInstance: number;
  /** 这一段里刚输出的内容是不是以空白结尾（段首也算）：HTML 里相邻节点的空白要像浏览器那样并成一个 */
  atSpace: boolean;
}

const MAX_IMAGE_WIDTH = 560; // A4 去掉页边距之后大约放得下这么宽（像素，按 96dpi）
const MONO = 'Consolas';
const QUOTE_COLOR = '6B7280';

/** 行内格式是一层层套下来的，走到文字节点时把攒下来的格式一起给它 */
interface Fmt { bold?: boolean; italics?: boolean; strike?: boolean; superScript?: boolean; subScript?: boolean; color?: string; size?: number; underline?: boolean; code?: boolean; highlight?: boolean }

function run(ctx: Ctx, text: string, f: Fmt): ParagraphChild {
  const { TextRun, ShadingType } = ctx.d;
  return new TextRun({
    text,
    bold: f.bold, italics: f.italics, strike: f.strike, superScript: f.superScript, subScript: f.subScript, color: f.color, size: f.size,
    underline: f.underline ? {} : undefined,
    highlight: f.highlight ? 'yellow' : undefined,
    ...(f.code ? { font: MONO, shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } } : {}),
  });
}

/** KaTeX 渲染出来的公式里带着 LaTeX 原文：Word 里显示原文（转成 Word 公式超出这里的范围） */
const latexOf = (el: Element) => el.getAttribute('data-latex') || el.closest('[data-latex]')?.getAttribute('data-latex') || el.querySelector('annotation[encoding="application/x-tex"]')?.textContent || el.textContent || '';

async function inline(ctx: Ctx, node: Node, f: Fmt, out: ParagraphChild[]): Promise<void> {
  if (node.nodeType === Node.TEXT_NODE) {
    let text = (node.textContent || '').replace(/\s+/g, ' ');
    if (ctx.atSpace) text = text.replace(/^ /, '');
    if (!text) return;
    ctx.atSpace = text.endsWith(' ');
    out.push(run(ctx, text, f));
    return;
  }
  if (!(node instanceof Element)) return;
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') { out.push(new ctx.d.TextRun({ break: 1 })); ctx.atSpace = true; return; }
  if (tag === 'img') {
    const img = await ctx.opts.loadImage(node.getAttribute('src') || '');
    if (img) out.push(imageRun(ctx, img, node as HTMLElement));
    else out.push(run(ctx, `[图片：${node.getAttribute('alt') || node.getAttribute('src') || ''}]`, { ...f, color: QUOTE_COLOR }));
    ctx.atSpace = false;
    return;
  }
  if (node.classList.contains('math-inline') || node.classList.contains('katex') || node.hasAttribute('data-inline-math')) { out.push(run(ctx, `$${latexOf(node)}$`, { ...f, code: true })); ctx.atSpace = false; return; }
  if (tag === 'input' && (node as HTMLInputElement).type === 'checkbox') {
    out.push(run(ctx, (node as HTMLInputElement).checked ? '☑ ' : '☐ ', f));
    ctx.atSpace = true;
    return;
  }
  if (tag === 'a' && /^https?:|^mailto:/i.test(node.getAttribute('href') || '')) {
    const children: ParagraphChild[] = [];
    for (const c of Array.from(node.childNodes)) await inline(ctx, c, { ...f, color: '2563EB', underline: true }, children);
    out.push(new ctx.d.ExternalHyperlink({ link: node.getAttribute('href')!, children }));
    return;
  }
  if (node.classList.contains('footnote-back')) return; // ↩ 在纸面上没意义
  const next: Fmt = { ...f };
  if (tag === 'strong' || tag === 'b') next.bold = true;
  if (tag === 'em' || tag === 'i') next.italics = true;
  if (tag === 'del' || tag === 's') next.strike = true;
  if (tag === 'u') next.underline = true;
  if (tag === 'mark') next.highlight = true;
  if (tag === 'code' || tag === 'kbd') next.code = true;
  if (tag === 'sup') next.superScript = true;
  if (tag === 'sub') next.subScript = true;
  for (const c of Array.from(node.childNodes)) await inline(ctx, c, next, out);
}

function imageRun(ctx: Ctx, img: DocxImage, el?: HTMLElement): ParagraphChild {
  // 笔记里给图片指定过宽度（![[图.png|300]]、<img width>）就用它，但不超过页面
  const wanted = parseFloat(el?.style.width || '') || Number(el?.getAttribute('width')) || img.width;
  const width = Math.max(1, Math.min(MAX_IMAGE_WIDTH, wanted, img.width));
  return new ctx.d.ImageRun({ type: 'png', data: img.data, transformation: { width, height: Math.round((img.height / img.width) * width) } });
}

interface BlockStyle { indent: number; quote?: boolean; color?: string }

const paraOptions = (ctx: Ctx, s: BlockStyle): Partial<IParagraphOptions> => ({
  indent: s.indent ? { left: s.indent * 360 } : undefined,
  border: s.quote ? { left: { style: ctx.d.BorderStyle.SINGLE, size: 12, color: 'C7D2FE', space: 8 } } : undefined,
});

async function paragraph(ctx: Ctx, el: Element, s: BlockStyle, extra: Partial<IParagraphOptions> = {}, f: Fmt = {}): Promise<DocxParagraph> {
  const children: ParagraphChild[] = [];
  ctx.atSpace = true;
  for (const c of Array.from(el.childNodes)) await inline(ctx, c, { ...f, color: f.color ?? s.color }, children);
  return new ctx.d.Paragraph({ children, spacing: { after: 140, line: 340 }, ...paraOptions(ctx, s), ...extra });
}

async function list(ctx: Ctx, el: Element, level: number, s: BlockStyle, out: Block[]): Promise<void> {
  const ordered = el.tagName.toLowerCase() === 'ol';
  const instance = ordered ? ++ctx.listInstance : 0;
  for (const li of Array.from(el.children).filter((c) => c.tagName === 'LI')) {
    // 列表项自己的文字（和行内元素）是一段；里面嵌套的列表、代码块等另起
    const own = document.createElement('div');
    const nested: Element[] = [];
    for (const c of Array.from(li.childNodes)) {
      if (c instanceof Element && /^(ul|ol|pre|table|blockquote)$/i.test(c.tagName)) nested.push(c);
      else if (c instanceof Element && c.tagName === 'P') { if (own.childNodes.length) own.appendChild(document.createElement('br')); own.append(...Array.from(c.cloneNode(true).childNodes)); }
      else if (c instanceof Element && c.tagName === 'LABEL') own.append(...Array.from(c.cloneNode(true).childNodes));
      else own.appendChild(c.cloneNode(true));
    }
    const isTask = !!own.querySelector('input[type="checkbox"]') || li.hasAttribute('data-checked');
    if (li.hasAttribute('data-checked') && !own.querySelector('input')) own.prepend(document.createTextNode(li.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ '));
    out.push(await paragraph(ctx, own, s, {
      spacing: { after: 60, line: 320 },
      ...(isTask ? { indent: { left: (s.indent + level + 1) * 360 } }
        : ordered ? { numbering: { reference: 'iml-ordered', level: Math.min(level, 5), instance } }
        : { bullet: { level: Math.min(level, 5) } }),
    }));
    for (const n of nested) {
      if (/^(ul|ol)$/i.test(n.tagName)) await list(ctx, n, level + 1, s, out);
      else await block(ctx, n, { ...s, indent: s.indent + level + 1 }, out);
    }
  }
}

async function table(ctx: Ctx, el: Element): Promise<DocxTable> {
  const { Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType } = ctx.d;
  const rows: InstanceType<typeof TableRow>[] = [];
  for (const tr of Array.from(el.querySelectorAll('tr'))) {
    const cells: InstanceType<typeof TableCell>[] = [];
    for (const cell of Array.from(tr.children)) {
      const head = cell.tagName === 'TH';
      const align = (cell as HTMLElement).style.textAlign || cell.getAttribute('align') || '';
      cells.push(new TableCell({
        children: [await paragraph(ctx, cell, { indent: 0 }, { spacing: { after: 0 }, alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT }, head ? { bold: true } : {})],
        shading: head ? { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
      }));
    }
    if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: !!tr.querySelector('th') }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

async function block(ctx: Ctx, el: Element, s: BlockStyle, out: Block[]): Promise<void> {
  const { Paragraph, TextRun, HeadingLevel, BorderStyle, ShadingType, AlignmentType } = ctx.d;
  const tag = el.tagName.toLowerCase();
  const cls = el.classList;

  if (/^h[1-6]$/.test(tag)) {
    const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Number(tag[1]) - 1];
    out.push(await paragraph(ctx, el, s, { heading: level, spacing: { before: 280, after: 140 } }));
  } else if (tag === 'p') {
    // 只有一张图的段落：图居中单放
    const onlyImg = el.children.length === 1 && el.children[0].tagName === 'IMG' && !(el.textContent || '').trim();
    out.push(await paragraph(ctx, el, s, onlyImg ? { alignment: AlignmentType.CENTER } : {}));
  } else if (tag === 'ul' || tag === 'ol') {
    await list(ctx, el, 0, s, out);
  } else if (tag === 'pre') {
    const lines = (el.textContent || '').replace(/\n$/, '').split('\n');
    lines.forEach((line, i) => out.push(new Paragraph({
      children: [new TextRun({ text: line || ' ', font: MONO, size: 19 })],
      shading: { type: ShadingType.CLEAR, fill: 'F6F8FA', color: 'auto' },
      spacing: { after: i === lines.length - 1 ? 160 : 0, line: 280 },
      ...paraOptions(ctx, s),
    })));
  } else if (tag === 'blockquote') {
    for (const c of Array.from(el.children)) await block(ctx, c, { ...s, quote: true, color: QUOTE_COLOR }, out);
    if (!el.children.length && (el.textContent || '').trim()) out.push(await paragraph(ctx, el, { ...s, quote: true, color: QUOTE_COLOR }));
  } else if (tag === 'table') {
    out.push(await table(ctx, el));
    out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
  } else if (tag === 'hr') {
    out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 1 } }, spacing: { before: 120, after: 200 } }));
  } else if (tag === 'img') {
    const img = await ctx.opts.loadImage(el.getAttribute('src') || '');
    out.push(new Paragraph({ children: [img ? imageRun(ctx, img, el as HTMLElement) : run(ctx, `[图片：${el.getAttribute('alt') || ''}]`, { color: QUOTE_COLOR })], alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
  } else if (cls.contains('math-block')) {
    out.push(new Paragraph({ children: [new TextRun({ text: `$$ ${latexOf(el).trim()} $$`, font: MONO })], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 160 } }));
  } else if (cls.contains('mermaid-static-rendered') || cls.contains('svg-static-rendered') || cls.contains('svg-preview-container')) {
    // 流程图 / SVG：交给取图函数去栅格化（它认 svg: 前缀）；不行就留一行说明
    const svg = el.querySelector('svg');
    const img = svg ? await ctx.opts.loadImage(`svg:${new XMLSerializer().serializeToString(svg)}`) : null;
    out.push(new Paragraph({ children: [img ? imageRun(ctx, img) : run(ctx, '[图：请在应用里查看]', { color: QUOTE_COLOR })], alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
  } else if (cls.contains('callout')) {
    const title = el.querySelector('.callout__title, .callout__head');
    if (title) out.push(await paragraph(ctx, title, { ...s, quote: true }, {}, { bold: true }));
    const body = el.querySelector('.callout__body') || el;
    for (const c of Array.from(body.children)) if (c !== title) await block(ctx, c, { ...s, quote: true }, out);
  } else if (cls.contains('note-embed')) {
    const head = el.querySelector(':scope > .note-embed__head');
    if (head) out.push(await paragraph(ctx, head, { ...s, quote: true }, { spacing: { after: 60 } }, { bold: true, color: '4F46E5', size: 19 }));
    const body = el.querySelector(':scope > .note-embed__body');
    if (body) for (const c of Array.from(body.children)) await block(ctx, c, { ...s, quote: true }, out);
    else for (const c of Array.from(el.children)) if (c !== head) await block(ctx, c, { ...s, quote: true }, out);
    if (!el.children.length && (el.textContent || '').trim()) out.push(await paragraph(ctx, el, { ...s, quote: true, color: QUOTE_COLOR }));
  } else if (cls.contains('footnotes')) {
    out.push(new Paragraph({ children: [], border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 1 } }, spacing: { before: 240, after: 80 } }));
    for (const def of Array.from(el.children)) out.push(await paragraph(ctx, def, s, { spacing: { after: 60 } }, { size: 18, color: QUOTE_COLOR }));
  } else if (cls.contains('frontmatter-card') || cls.contains('toc-block')) {
    // 属性卡片、目录：和导出 PDF 一样不进正文（目录在 Word 里应该用 Word 自己的）
  } else if (tag === 'details') {
    const summary = el.querySelector(':scope > summary');
    if (summary) out.push(await paragraph(ctx, summary, s, {}, { bold: true }));
    for (const c of Array.from(el.children)) if (c !== summary) await block(ctx, c, { ...s, indent: s.indent + 1 }, out);
  } else if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'figure') {
    // 纯容器往里走；里面直接是文字的当一段
    if (el.children.length && Array.from(el.children).some((c) => /^(p|h[1-6]|ul|ol|pre|table|blockquote|div|img|hr|details)$/i.test(c.tagName))) {
      for (const c of Array.from(el.children)) await block(ctx, c, s, out);
    } else if ((el.textContent || '').trim() || el.querySelector('img')) out.push(await paragraph(ctx, el, s));
  } else if ((el.textContent || '').trim()) {
    out.push(await paragraph(ctx, el, s));
  }
}

/** 静态 HTML → docx 文件的字节 */
export async function htmlToDocx(html: string, opts: DocxOptions): Promise<Uint8Array> {
  const d = await import('docx');
  const ctx: Ctx = { d, opts, listInstance: 0, atSpace: true };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: Block[] = [];
  for (const el of Array.from(doc.body.children)) await block(ctx, el, { indent: 0 }, blocks);
  if (blocks.length === 0) blocks.push(new d.Paragraph({ children: [] }));

  const file = new d.Document({
    title: opts.title,
    creator: 'iML 编辑器',
    styles: {
      default: {
        document: { run: { font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei', cs: 'Calibri' }, size: 22 } },
        heading1: { run: { size: 40, bold: true }, paragraph: { spacing: { before: 320, after: 160 } } },
        heading2: { run: { size: 32, bold: true } },
        heading3: { run: { size: 27, bold: true } },
        heading4: { run: { size: 24, bold: true } },
      },
    },
    numbering: {
      config: [{
        reference: 'iml-ordered',
        levels: [0, 1, 2, 3, 4, 5].map((level) => ({
          level,
          format: [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN][level % 3],
          text: `%${level + 1}.`,
          alignment: d.AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1300, right: 1300 } } }, children: blocks }],
  });
  const blob = await d.Packer.toBlob(file);
  return new Uint8Array(await blob.arrayBuffer());
}
