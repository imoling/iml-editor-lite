/**
 * 用户 CSS 片段：<笔记库>/.iml/snippets.css。想改个字体颜色、调个行距、换个引用块的样子，写几行 CSS 就行，
 * 不用等应用出设置项。只是样式表——不执行任何代码，这是我们不做插件系统之后留的那个「口子」。
 *
 * 样式表也能往外发请求（@import、url(http…)），而这个应用答应过「不联网的时候就真的不联网」，
 * 所以注入之前把会访问外部地址的写法去掉。
 */
export const SNIPPETS_DIR = '.iml';
export const SNIPPETS_FILE = 'snippets.css';
const STYLE_ID = 'iml-user-snippets';
const MAX_BYTES = 200 * 1024;

export const SNIPPETS_TEMPLATE = `/* iML Markdown Editor · 自定义样式
 *
 * 这里写的 CSS 会在应用启动、以及保存这个文件时生效。只改外观，不执行任何代码。
 * 出于隐私考虑，@import 和指向网络地址的 url(...) 会被忽略。
 * 改坏了？清空这个文件，或在「设置 → 编辑器」里关掉「自定义样式」。
 *
 * 几个例子（去掉注释即可）：
 */

/* 正文换个字体、行距拉开一点 */
/* .tiptap-prosemirror { font-family: "LXGW WenKai", "Songti SC", serif; line-height: 2; } */

/* 一级标题下面加一条线 */
/* .tiptap-prosemirror h1 { border-bottom: 2px solid var(--color-brand-indigo); padding-bottom: 6px; } */

/* 引用块换个颜色 */
/* .tiptap-prosemirror blockquote { border-left-color: #e0a100; background: rgba(224, 161, 0, 0.06); } */
`;

/** 去掉会联网的写法、会提前结束 <style> 的字符；太大的文件直接不要（多半是放错了东西） */
export function sanitizeUserCss(css: string): string {
  if (!css || css.length > MAX_BYTES) return '';
  return css
    .replace(/<\/?style[^>]*>/gi, '')
    // 只吃到这一行的结尾或分号为止，并且是删掉而不是换成注释：
    // 换成注释的话，如果它本来就在一段注释里（比如说明文字提到了 @import），新注释的 */ 会把外层注释提前关掉
    .replace(/@import\b[^;\n]*;?/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:https?:|\/\/|ftp:)[^)]*\)/gi, 'url($1$1)');
}

/** 注入（或更新）样式表；传空串就是撤掉 */
export function applyUserCss(css: string): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const clean = sanitizeUserCss(css);
  if (!clean.trim()) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    // 放在最后：同样的选择器，用户写的赢过应用自己的
    document.head.appendChild(el);
  }
  el.textContent = clean;
}

export const snippetsPathOf = (libraryRoot: string) => {
  const sep = libraryRoot.includes('\\') ? '\\' : '/';
  return `${libraryRoot.replace(/[/\\]+$/, '')}${sep}${SNIPPETS_DIR}${sep}${SNIPPETS_FILE}`;
};
