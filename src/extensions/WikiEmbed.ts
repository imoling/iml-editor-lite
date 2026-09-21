import { Node, mergeAttributes } from '@tiptap/core';

/**
 * 嵌入：Markdown 里独占一段的 `![[笔记]]`、`![[笔记#小节]]`、`![[截图.png|300]]`（Obsidian 的写法）。
 * 轻量版不解析嵌入（那要读别的笔记），编辑器里显示成原文；保存时写回原来的 `![[…]]`，一个字不动。
 * 要改嵌入的目标：删掉重写，或切到源码模式改。
 */
export const WikiEmbed = Node.create({
  name: 'wikiEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-wiki-embed') || '',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-wiki-embed': attrs.target }),
      },
      /** 竖线后面的部分：图片是尺寸（300 / 300x200），笔记嵌入里没有意义但照原样留着 */
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-embed-label') || '',
        renderHTML: (attrs: Record<string, any>) => (attrs.label ? { 'data-embed-label': attrs.label } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-wiki-embed]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { target, label } = node.attrs;
    return ['div', mergeAttributes(HTMLAttributes), `![[${label ? `${target}|${label}` : target}]]`];
  },
});
