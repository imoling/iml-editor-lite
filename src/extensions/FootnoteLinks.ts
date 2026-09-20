import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

export const footnoteLinksKey = new PluginKey<DecorationSet>('footnoteLinks');

const REF_RE = /\[\^([^\]\s]+)\]/g;

/** 正文里的脚注引用 `[^1]` 的位置（代码里的不算） */
export function findFootnoteRefs(doc: PMNode): { from: number; to: number; id: string }[] {
  const out: { from: number; to: number; id: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : '￼'));
    if (!text.includes('[^')) return false;
    for (const m of text.matchAll(REF_RE)) {
      const from = pos + 1 + (m.index ?? 0);
      if ((doc.nodeAt(from)?.marks ?? []).some((mark) => mark.type.name === 'code')) continue;
      out.push({ from, to: from + m[0].length, id: m[1] });
    }
    return false;
  });
  return out;
}

/** 脚注定义所在的块：富文本里它是一个「原样保留」块，原文里有一行以 `[^id]:` 开头 */
export function findFootnoteDef(doc: PMNode, id: string): number {
  let found = -1;
  const head = `[^${id}]:`;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.type.name === 'rawBlock' && String(node.attrs.raw ?? '').split('\n').some((l) => l.trimStart().startsWith(head))) { found = pos; return false; }
    return !node.isTextblock;
  });
  return found;
}

/** 点了 `[^id]`：选中并滚到它的定义；没有这条脚注返回 false，让点击照常落光标 */
export function jumpToFootnote(view: EditorView, id: string): boolean {
  const pos = findFootnoteDef(view.state.doc, id);
  if (pos === -1) return false;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  (view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  return true;
}

/**
 * 脚注引用在文档里就是字面的 `[^1]`（保存时原样写出），这里加一层装饰让它看着像上标、能点。
 * 悬停的提示里直接带上脚注内容，多数时候不用真跳过去。
 */
export const FootnoteLinks = Extension.create({
  name: 'footnoteLinks',

  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const texts = new Map<string, string>();
      doc.descendants((node) => {
        if (node.type.name !== 'rawBlock') return !node.isTextblock;
        for (const m of String(node.attrs.raw ?? '').matchAll(/^[ \t]*\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n[ \t]{2,}[^\n]+)*)/gm)) texts.set(m[1], m[2].replace(/\n[ \t]+/g, ' ').trim());
        return false;
      });
      return DecorationSet.create(doc, findFootnoteRefs(doc).map((r) => Decoration.inline(r.from, r.to, {
        class: `footnote-ref-inline${texts.has(r.id) ? '' : ' footnote-ref-inline--missing'}`,
        'data-footnote-ref': r.id,
        title: texts.get(r.id) ?? '没有这条脚注的定义',
      })));
    };
    return [
      new Plugin<DecorationSet>({
        key: footnoteLinksKey,
        state: { init: (_c, state) => build(state.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
        props: { decorations(state) { return footnoteLinksKey.getState(state); } },
      }),
    ];
  },
});
