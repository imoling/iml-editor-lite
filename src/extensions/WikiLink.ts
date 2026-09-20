import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface WikiLinkAttrs {
  target: string;
  label: string;
}

/**
 * 双向链接节点：Markdown 里写作 `[[笔记名]]` 或 `[[笔记名|显示文本]]`。
 * 行内原子节点，渲染成可点击的芯片；点击行为由编辑器的 handleClick 处理（打开或新建目标笔记）。
 */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-wiki-link') || el.textContent || '',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-wiki-link': attrs.target }),
      },
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.textContent || el.getAttribute('data-wiki-link') || '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wiki-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'wiki-link' }), node.attrs.label || node.attrs.target];
  },

  /** 直接敲完 `[[xxx]]` 也能变成链接节点 */
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]$/,
        handler: ({ range, match, chain }) => {
          const target = match[1].trim();
          if (!target) return;
          chain()
            .insertContentAt(range, [{ type: this.name, attrs: { target, label: (match[2] || match[1]).trim() } }, { type: 'text', text: ' ' }])
            .run();
        },
      }),
    ];
  },
});
