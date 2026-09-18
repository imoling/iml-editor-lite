import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { findTags } from '../../electron/shared/noteMeta';

export const tagHighlightKey = new PluginKey<DecorationSet>('tagHighlight');

/** 文档里所有 #标签 的位置。按整段文字判断边界：「**粗体**#x」里的 #x 前面是「体」，不算标签 */
export function findTagRanges(doc: PMNode): { from: number; to: number; tag: string }[] {
  const out: { from: number; to: number; tag: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    // 行内原子节点各占 1 个位置，换成 1 个占位字符，文本下标与文档位置一一对应
    const text = node.textBetween(0, node.content.size, undefined, (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : '￼'));
    if (!text.includes('#')) return false;
    for (const t of findTags(text)) {
      const from = pos + 1 + t.from;
      const marks = doc.nodeAt(from)?.marks ?? [];
      if (marks.some((m) => m.type.name === 'code')) continue;
      out.push({ from, to: pos + 1 + t.to, tag: t.tag });
    }
    return false;
  });
  return out;
}

function build(doc: PMNode): DecorationSet {
  return DecorationSet.create(doc, findTagRanges(doc).map((r) => Decoration.inline(r.from, r.to, { class: 'tag-chip', 'data-tag': r.tag })));
}

/**
 * #标签 高亮。标签在文档里就是普通文字（保存时原样写出），这里只加一层装饰；
 * 点击行为由编辑器的 handleClick 处理（打开侧边栏的标签视图）。
 */
export const TagHighlight = Extension.create({
  name: 'tagHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: tagHighlightKey,
        state: {
          init: (_config, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return tagHighlightKey.getState(state);
          },
        },
      }),
    ];
  },
});
