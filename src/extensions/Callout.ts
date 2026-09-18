import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { calloutKind, calloutLabel, CALLOUT_LABELS, type CalloutKind } from '../../electron/shared/noteMeta';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** 把当前块包进提示块；已经在提示块里则拆出来 */
      toggleCallout: (type?: string) => ReturnType;
    };
  }
}

const KIND_ICONS: Record<CalloutKind, string> = { note: 'ℹ', tip: '💡', important: '❗', warning: '⚠', caution: '⛔' };
const KIND_ORDER: CalloutKind[] = ['note', 'tip', 'important', 'warning', 'caution'];

/**
 * 提示块：Markdown 里写作 `> [!NOTE] 可选标题`（GitHub / Obsidian 通用）。
 * 类型名与折叠标记（+ / -）按原文保留；不认识的类型用 note 的配色，但保存时类型名不变。
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'NOTE',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-callout') || 'NOTE',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-callout': attrs.type }),
      },
      fold: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-fold') || '',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-fold': attrs.fold }),
      },
      title: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-title') || '',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-title': attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-callout]',
      contentElement: (el: HTMLElement) => (el.querySelector(':scope > .callout__body') as HTMLElement) || el,
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: `callout callout--${calloutKind(node.attrs.type)}` }),
      ['div', { class: 'callout__body' }, 0],
    ];
  },

  addCommands() {
    return {
      toggleCallout: (type = 'NOTE') => ({ commands, editor }) => {
        if (editor.isActive(this.name)) return commands.lift(this.name);
        return commands.wrapIn(this.name, { type });
      },
    };
  },

  /** 在引用块的第一行敲 `[!NOTE] ` → 引用块变成提示块 */
  addInputRules() {
    return [
      new InputRule({
        find: /^\[!([A-Za-z][\w-]*)\]([+-]?)\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.depth < 2) return null;
          const quote = $from.node(-1);
          if (quote.type.name !== 'blockquote' || $from.index(-1) !== 0) return null;
          const tr = state.tr.delete(range.from, range.to);
          tr.setNodeMarkup($from.before(-1), this.type, { type: match[1], fold: match[2] || '', title: '' });
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      const head = document.createElement('div');
      head.className = 'callout__title';
      head.contentEditable = 'false';
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'callout__badge';
      badge.title = '切换类型';
      const titleInput = document.createElement('input');
      titleInput.className = 'callout__title-input';
      titleInput.spellcheck = false;
      const menu = document.createElement('div');
      menu.className = 'callout__menu';
      menu.style.display = 'none';
      head.append(badge, titleInput, menu);

      const contentDOM = document.createElement('div');
      contentDOM.className = 'callout__body';
      dom.append(head, contentDOM);

      const setAttrs = (patch: Record<string, unknown>) => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch }));
      };

      const paint = () => {
        const kind = calloutKind(current.attrs.type);
        dom.className = `callout callout--${kind}`;
        badge.textContent = `${KIND_ICONS[kind]} ${calloutLabel(current.attrs.type)}`;
        if (document.activeElement !== titleInput) titleInput.value = current.attrs.title || '';
        titleInput.placeholder = '标题（可选）';
      };

      // 新选的类型沿用原文的大小写习惯：[!note] 的库继续写小写，[!NOTE] 的继续写大写
      const typeFor = (kind: CalloutKind) => {
        const t = String(current.attrs.type || '');
        return t && t === t.toLowerCase() ? kind : kind.toUpperCase();
      };

      KIND_ORDER.forEach((kind) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `callout__menu-item callout__menu-item--${kind}`;
        item.textContent = `${KIND_ICONS[kind]} ${CALLOUT_LABELS[kind]}`;
        item.addEventListener('mousedown', (e) => e.preventDefault());
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.style.display = 'none';
          setAttrs({ type: typeFor(kind) });
        });
        menu.appendChild(item);
      });

      const closeMenu = () => { menu.style.display = 'none'; };
      badge.addEventListener('mousedown', (e) => e.preventDefault());
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!editor.isEditable) return;
        const open = menu.style.display === 'none';
        menu.style.display = open ? '' : 'none';
        if (open) setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
      });

      const commitTitle = () => {
        const next = titleInput.value.replace(/\s+/g, ' ').trim();
        if (next !== (current.attrs.title || '')) setAttrs({ title: next });
      };
      titleInput.addEventListener('blur', commitTitle);
      titleInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if ((e.key === 'Enter' && !e.isComposing) || e.key === 'Escape') {
          e.preventDefault();
          if (e.key === 'Escape') titleInput.value = current.attrs.title || '';
          titleInput.blur();
          editor.commands.focus();
        }
      });

      paint();

      return {
        dom,
        contentDOM,
        stopEvent: (event) => head.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) => mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          paint();
          return true;
        },
        destroy: () => document.removeEventListener('click', closeMenu),
      };
    };
  },
});
