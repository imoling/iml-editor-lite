import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { createSourceNodeView } from './sourceNodeView';

export const MathExtension = Node.create({
  name: 'math',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      latex: {
        default: 'e = mc^2',
        parseHTML: element => element.getAttribute('data-latex'),
        renderHTML: attributes => ({
          'data-latex': attributes.latex,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-latex]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // 带上 latex 文本：空 div 会被 turndown 视为空白节点直接丢掉，公式就无法保存
    return ['div', mergeAttributes(HTMLAttributes, { class: 'math-block' }), HTMLAttributes['data-latex'] || ''];
  },

  addNodeView() {
    // 单击进入 LaTeX 编辑（原来用的 window.prompt 在 Electron 里不可用）
    return ({ node, editor, getPos }) => createSourceNodeView({
      node, editor, getPos,
      className: 'math-block-container',
      title: '单击编辑公式（LaTeX）· ⌘Enter 确认',
      editOn: 'click',
      multiline: true,
      getSource: (n) => n.attrs.latex || '',
      toAttrs: (source) => (source.trim() ? { latex: source.trim() } : null),
      render: (display, n) => {
        try {
          katex.render(n.attrs.latex || '', display, { displayMode: true, throwOnError: false });
        } catch {
          display.textContent = n.attrs.latex;
        }
      },
    });
  },
});
