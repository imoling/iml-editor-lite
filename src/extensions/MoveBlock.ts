import { Extension } from '@tiptap/core';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';

const ITEM_TYPES = new Set(['listItem', 'taskItem']);
/** 这些块有固定的位置，不参与挪动：属性块必须留在文档最前面 */
const PINNED = new Set(['frontmatter']);

/**
 * 把光标所在的那一块整体上移 / 下移一位（⌥↑ / ⌥↓，和 VS Code、Obsidian 的大纲插件一个习惯）。
 * 光标在列表里：挪的是那个列表项（连同它下面缩进的子项），只在同一层的兄弟之间换位置；
 * 不在列表里：挪的是最外层的那一块（段落、标题、代码块、表格、嵌入…）。
 * 已经到头了就什么都不做，但仍然返回 true——别让这组按键漏下去变成别的意思。
 */
export function moveBlock(state: EditorState, dir: -1 | 1, dispatch?: (tr: Transaction) => void): boolean {
  const { selection } = state;
  const { $from } = selection;

  // 选中的是一个原子块（嵌入、公式、目录…）：它自己就是要挪的那一块
  let depth = selection instanceof NodeSelection && $from.depth === 0 ? 0 : -1;
  if (depth === -1) {
    for (let d = $from.depth; d > 0; d--) if (ITEM_TYPES.has($from.node(d).type.name)) { depth = d; break; }
    if (depth === -1) depth = 1;
  }

  const atomTop = depth === 0;
  const parent = atomTop ? state.doc : $from.node(depth - 1);
  const index = atomTop ? $from.index(0) : $from.index(depth - 1);
  const node = atomTop ? (selection as NodeSelection).node : $from.node(depth);
  const pos = atomTop ? selection.from : $from.before(depth);
  const target = index + dir;
  if (target < 0 || target >= parent.childCount) return true;
  const sibling = parent.child(target);
  if (PINNED.has(node.type.name) || PINNED.has(sibling.type.name)) return true;
  if (!dispatch) return true;

  const tr = state.tr;
  const newPos = dir === -1 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  tr.delete(pos, pos + node.nodeSize);
  tr.insert(dir === -1 ? newPos : pos + sibling.nodeSize, node);
  // 光标跟着这一块走，在块内的相对位置不变
  if (atomTop) tr.setSelection(NodeSelection.create(tr.doc, newPos));
  else tr.setSelection(TextSelection.create(tr.doc, newPos + (selection.anchor - pos), newPos + (selection.head - pos)));
  dispatch(tr.scrollIntoView());
  return true;
}

export const MoveBlock = Extension.create({
  name: 'moveBlock',
  priority: 1001,
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => moveBlock(this.editor.state, -1, this.editor.view.dispatch),
      'Alt-ArrowDown': () => moveBlock(this.editor.state, 1, this.editor.view.dispatch),
    };
  },
});
