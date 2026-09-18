import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import katex from 'katex';
import { createSourceNodeView } from './sourceNodeView';

/**
 * 行内公式 `$…$`（以及写在一行里的 `$$…$$`）。
 * 作为原子节点保存 LaTeX 原文：里面的 _ * \ 不会再被当成 Markdown 语法转义，编辑器里用 KaTeX 渲染，单击修改。
 */
export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') || el.textContent || '',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-latex': attrs.latex }),
      },
      display: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-inline-math') === 'display',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-inline-math': attrs.display ? 'display' : 'inline' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-inline-math]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), node.attrs.latex || ' '];
  },

  renderText({ node }) {
    return node.attrs.display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`;
  },

  /** 敲完 `$x^2$` 自动变成公式；两端不能贴着空格，避免「$5 和 $10」被误判 */
  addInputRules() {
    return [
      new InputRule({
        find: /(^|[^$\\\w])\$(?![\s$])([^$\n]+?)(?<!\s)\$$/,
        handler: ({ range, match, chain }) => {
          const latex = match[2];
          if (!latex || /^\d+([.,]\d+)?$/.test(latex)) return;
          chain()
            .insertContentAt({ from: range.from + match[1].length, to: range.to }, { type: this.name, attrs: { latex, display: false } })
            .run();
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => createSourceNodeView({
      node, editor, getPos,
      tag: 'span',
      className: 'math-inline',
      title: '单击编辑公式（LaTeX）',
      editOn: 'click',
      getSource: (n) => n.attrs.latex,
      toAttrs: (source) => (source.trim() ? { latex: source.trim() } : null),
      render: (display, n) => {
        try {
          katex.render(n.attrs.latex, display, { displayMode: !!n.attrs.display, throwOnError: false });
        } catch {
          display.textContent = n.attrs.latex;
        }
      },
    });
  },
});
