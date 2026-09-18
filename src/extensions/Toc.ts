import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toc: {
      insertToc: () => ReturnType;
    };
  }
}

/**
 * 自动目录：Markdown 里独占一行的 `[TOC]`（Typora 等编辑器通用）。
 * 编辑器里实时列出文档的标题，点击跳转；保存时写回 `[TOC]`，不会变成 `\[TOC\]`。
 */
export const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '' }), '[TOC]'];
  },

  addCommands() {
    return {
      insertToc: () => ({ commands }) => commands.insertContent({ type: this.name }),
    };
  },

  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div');
      dom.className = 'toc-block';
      dom.contentEditable = 'false';
      let signature = '';

      const paint = () => {
        const items: { level: number; text: string; pos: number }[] = [];
        editor.state.doc.descendants((n, pos) => {
          if (n.type.name === 'heading') items.push({ level: n.attrs.level, text: n.textContent, pos });
          return !n.isTextblock;
        });
        const next = items.map((i) => `${i.level}:${i.text}`).join('\n');
        if (next === signature && dom.childElementCount > 0) {
          // 标题没变，只更新跳转位置
          Array.from(dom.querySelectorAll<HTMLElement>('.toc-block__item')).forEach((el, i) => { el.dataset.pos = String(items[i]?.pos ?? 0); });
          return;
        }
        signature = next;
        dom.innerHTML = '';
        const label = document.createElement('div');
        label.className = 'toc-block__label';
        label.textContent = '目录';
        dom.appendChild(label);
        if (items.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'toc-block__empty';
          empty.textContent = '文档里还没有标题';
          dom.appendChild(empty);
          return;
        }
        const min = Math.min(...items.map((i) => i.level));
        for (const item of items) {
          const el = document.createElement('a');
          el.className = 'toc-block__item';
          el.style.paddingLeft = `${(item.level - min) * 16}px`;
          el.textContent = item.text || '（空标题）';
          el.dataset.pos = String(item.pos);
          dom.appendChild(el);
        }
      };

      dom.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('.toc-block__item');
        if (!target) return;
        e.preventDefault();
        const pos = Number(target.dataset.pos);
        const el = editor.view.nodeDOM(pos) as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        editor.commands.setTextSelection(pos + 1);
      });

      let timer: ReturnType<typeof setTimeout> | null = null;
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(paint, 200);
      };
      editor.on('update', schedule);
      paint();

      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: (event) => event.type === 'click' && !!(event.target as HTMLElement).closest('.toc-block__item'),
        destroy: () => {
          if (timer) clearTimeout(timer);
          editor.off('update', schedule);
        },
      };
    };
  },
});
