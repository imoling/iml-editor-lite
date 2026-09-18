import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const focusKey = new PluginKey<boolean>('focusMode');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    focusMode: {
      setFocusMode: (enabled: boolean) => ReturnType;
    };
  }
}

/**
 * 专注模式：给光标所在的顶层块加 is-focus-block，样式把其余内容淡出。
 * 用装饰而不是直接改 DOM 的 class —— ProseMirror 重绘节点时会把手动加的 class 抹掉。
 */
export const FocusMode = Extension.create({
  name: 'focusMode',

  addCommands() {
    return {
      setFocusMode: (enabled: boolean) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(focusKey, enabled));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: focusKey,
        state: {
          init: () => false,
          apply: (tr, value) => {
            const meta = tr.getMeta(focusKey);
            return typeof meta === 'boolean' ? meta : value;
          },
        },
        props: {
          decorations(state) {
            if (!focusKey.getState(state)) return null;
            const { $head } = state.selection;
            if ($head.depth === 0) return null;
            const from = $head.before(1);
            const node = state.doc.nodeAt(from);
            if (!node) return null;
            return DecorationSet.create(state.doc, [Decoration.node(from, from + node.nodeSize, { class: 'is-focus-block' })]);
          },
        },
      }),
    ];
  },
});
