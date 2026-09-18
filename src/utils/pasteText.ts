/** 剪贴板里的纯文本是不是「就一个网址」 */
export function isSingleUrl(text: string): boolean {
  const t = (text || '').trim();
  return t.length > 0 && t.length < 2048 && /^https?:\/\/[^\s<>"']+$/i.test(t);
}

/** 链接文字里的方括号要转义，否则会把 [标题](url) 的结构弄坏 */
export function escapeLinkText(title: string): string {
  return title.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

const SEMANTIC_SELECTOR = 'a[href], strong, b, em, i, s, del, h1, h2, h3, h4, h5, h6, ul, ol, table, img, pre, code, blockquote, [data-wiki-link], [data-callout]';

/**
 * 源码模式里粘贴 HTML 时，值不值得转成 Markdown：
 * 从代码编辑器复制的内容（带语法高亮的一堆 span）必须按纯文本贴；只有真的带结构（链接、标题、列表、表格……）才转。
 */
export function htmlWorthConverting(html: string, types: readonly string[] = []): boolean {
  if (!html || types.includes('vscode-editor-data')) return false;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Google Docs 会把整段包进 <b style="font-weight:normal">，不算加粗
  doc.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]').forEach((b) => b.replaceWith(...Array.from(b.childNodes)));
  if (doc.body.querySelector('pre') && !doc.body.querySelector('a[href], h1, h2, h3, ul, ol, table, img, blockquote')) return false;
  return !!doc.body.querySelector(SEMANTIC_SELECTOR);
}
