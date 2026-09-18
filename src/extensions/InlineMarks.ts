import { Mark, mergeAttributes } from '@tiptap/core';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Link } from '@tiptap/extension-link';

/**
 * Markdown 里常见、但 StarterKit 不认识的行内 HTML 标记。
 * 没有这些 Mark 的话，<kbd>⌘</kbd> 这类标签在富文本模式里保存一次就只剩文字了。
 */
const htmlMark = (name: string, tag: string) =>
  Mark.create({
    name,
    parseHTML() {
      return [{ tag }];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes), 0];
    },
  });

export const Kbd = htmlMark('kbd', 'kbd');
export const Subscript = htmlMark('subscript', 'sub');
export const Superscript = htmlMark('superscript', 'sup');

/** 高亮：`==文字==`（Obsidian / Typora 写法）与 <mark> 两种来源，保存时各自写回原来的写法 */
export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      md: {
        default: true,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-md'),
        renderHTML: (attrs: Record<string, any>) => (attrs.md ? { 'data-md': '' } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * 换行：源文件里的单个换行（本应用按换行显示）标记为 soft，保存时仍写回单个换行；
 * 编辑器里新敲的 Shift+Enter 用标准的「行尾两个空格」，别的 Markdown 工具也能正确显示。
 */
export const SoftAwareHardBreak = HardBreak.extend({
  addAttributes() {
    return {
      soft: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-soft'),
        renderHTML: (attrs: Record<string, any>) => (attrs.soft ? { 'data-soft': '' } : {}),
      },
    };
  },
});

/** 链接：保留 title；记住源文件里是不是自动链接（裸链接 / <url>），保存时按原写法写回 */
export const NoteLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
      autolink: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-autolink'),
        renderHTML: (attrs: Record<string, any>) => (attrs.autolink ? { 'data-autolink': attrs.autolink } : {}),
      },
    };
  },
});
