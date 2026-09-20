import { Node, mergeAttributes } from '@tiptap/core';
import { useAppStore } from '../stores/appStore';
import { fillEmbed } from '../utils/noteEmbed';

/**
 * 嵌入：Markdown 里独占一段的 `![[笔记]]`、`![[笔记#小节]]`、`![[截图.png|300]]`（Obsidian 的写法）。
 * 编辑器里就地显示那篇笔记 / 那张图，只读（内容是别人的，要改去原笔记里改）；保存时写回原来的 `![[…]]`，一个字不动。
 * 要换嵌入的目标：删掉重写，或切到源码模式改。
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

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      let current = node;
      const paint = () => {
        dom.setAttribute('data-wiki-embed', current.attrs.target);
        if (current.attrs.label) dom.setAttribute('data-embed-label', current.attrs.label);
        else dom.removeAttribute('data-embed-label');
        const from = useAppStore.getState().activeTabId;
        void fillEmbed(dom, from, from ? [from] : []);
      };
      dom.contentEditable = 'false';
      dom.className = 'note-embed note-embed--loading';
      dom.textContent = `![[${node.attrs.target}]]`;
      paint();

      // 被嵌入的那篇改了（存盘 → 索引刷新 → libraryVersion 变）就重画；切到别的笔记时这个节点会被销毁，不用管
      let version = useAppStore.getState().libraryVersion;
      const unsubscribe = useAppStore.subscribe((state) => {
        if (state.libraryVersion === version) return;
        version = state.libraryVersion;
        paint();
      });

      return {
        dom,
        ignoreMutation: () => true,
        update: (next) => {
          if (next.type.name !== 'wikiEmbed') return false;
          const changed = next.attrs.target !== current.attrs.target || next.attrs.label !== current.attrs.label;
          current = next;
          if (changed) paint();
          return true;
        },
        destroy: () => unsubscribe(),
      };
    };
  },
});
