import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';

export interface SourceNodeViewOptions {
  node: PMNode;
  editor: Editor;
  getPos: (() => number | undefined) | boolean;
  tag?: 'div' | 'span';
  className: string;
  title?: string;
  /** 多行：⌘Enter 确认；单行：Enter 确认。失焦一律确认，Esc 取消 */
  multiline?: boolean;
  /** 单击还是双击进入编辑 */
  editOn?: 'click' | 'dblclick';
  /** 画出展示态；可以往 display 里挂自己的按钮（记得 stopPropagation） */
  render: (display: HTMLElement, node: PMNode, api: { edit: () => void }) => void;
  getSource: (node: PMNode) => string;
  /** 由编辑后的原文得到新属性；返回 null 表示删除整个节点 */
  toAttrs: (source: string, node: PMNode) => Record<string, unknown> | null;
}

/**
 * 「展示态 + 原文编辑态」的原子节点视图：frontmatter、原样保留的 HTML、公式都是这个形态。
 * 不用 window.prompt —— Electron 不支持它。
 */
export function createSourceNodeView(o: SourceNodeViewOptions): NodeView {
  let node = o.node;
  const tag = o.tag ?? 'div';
  const dom = document.createElement(tag);
  dom.className = o.className;
  dom.contentEditable = 'false';
  if (o.title) dom.title = o.title;

  const display = document.createElement(tag);
  display.className = 'source-node__display';
  dom.appendChild(display);

  let input: HTMLTextAreaElement | null = null;

  const edit = () => {
    if (input || !o.editor.isEditable) return;
    const value = o.getSource(node);
    const el = document.createElement('textarea');
    el.className = `source-node__input ${o.multiline ? 'source-node__input--multi' : ''}`;
    el.value = value;
    el.spellcheck = false;
    el.rows = o.multiline ? Math.min(18, Math.max(2, value.split('\n').length)) : 1;
    input = el;
    display.style.display = 'none';
    dom.classList.add('is-editing');
    dom.appendChild(el);

    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
        o.editor.view.focus();
      } else if (e.key === 'Enter' && !e.isComposing && (!o.multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        close(true);
        o.editor.view.focus();
      }
    });
    el.addEventListener('input', () => {
      if (o.multiline) el.rows = Math.min(18, Math.max(2, el.value.split('\n').length));
    });
    el.addEventListener('blur', () => close(true));
    requestAnimationFrame(() => {
      el.focus();
      if (!o.multiline) el.select();
    });
  };

  const close = (commit: boolean) => {
    if (!input) return;
    const el = input;
    input = null;
    const value = el.value;
    el.remove();
    dom.classList.remove('is-editing');
    display.style.display = '';
    if (!commit || value === o.getSource(node) || typeof o.getPos !== 'function') return;
    const pos = o.getPos();
    if (typeof pos !== 'number') return;
    const attrs = o.toAttrs(value, node);
    const tr = o.editor.state.tr;
    if (attrs === null) tr.delete(pos, pos + node.nodeSize);
    else tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    o.editor.view.dispatch(tr);
  };

  const paint = () => {
    display.innerHTML = '';
    o.render(display, node, { edit });
  };

  dom.addEventListener(o.editOn ?? 'dblclick', (e) => {
    if (input) return;
    e.preventDefault();
    e.stopPropagation();
    edit();
  });

  paint();

  return {
    dom,
    // 编辑态下所有事件都留给 textarea；展示态交给 ProseMirror（单击选中节点，Delete 可删）
    stopEvent: () => !!input,
    ignoreMutation: () => true,
    update: (updated) => {
      if (updated.type !== node.type) return false;
      node = updated;
      if (!input) paint();
      return true;
    },
    selectNode: () => dom.classList.add('ProseMirror-selectednode'),
    deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
    destroy: () => { input = null; },
  };
}
