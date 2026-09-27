import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateField, type Range, type Text } from '@codemirror/state';
import { formatBytes } from '../../utils/pasteImage';

/**
 * 源码模式：写进文档里的图片是一长串 base64（一张截图几十万个字符），原样摊开的话那一行没法看。
 * 这里把 `data:image/…;base64,` 后面那一长串折成一个小标签（「… 312 KB …」）。只是显示上折起来，文件内容不动；
 * 光标整体跳过它，删的时候整段删。
 */
const DATA_URL_RE = /data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]{200,})/gi;

export interface FoldRange { from: number; to: number; bytes: number }

/** 一段文字里要折起来的范围：只折 base64 那一段，前面的 `data:image/png;base64,` 留着，看得出是什么图 */
export function findDataUrlRanges(text: string, offset = 0): FoldRange[] {
  const out: FoldRange[] = [];
  for (const m of text.matchAll(DATA_URL_RE)) {
    const to = offset + (m.index ?? 0) + m[0].length;
    out.push({ from: to - m[1].length, to, bytes: Math.floor((m[1].replace(/=+$/, '').length * 3) / 4) });
  }
  return out;
}

class SizeWidget extends WidgetType {
  constructor(readonly bytes: number) { super(); }
  eq(other: SizeWidget) { return other.bytes === this.bytes; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-data-url-fold';
    el.textContent = `… ${formatBytes(this.bytes)} …`;
    return el;
  }
}

/** base64 不会跨行：按行扫，短的行直接跳过 */
function scan(doc: Text, from: number, to: number): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (let pos = from; pos <= to; ) {
    const line = doc.lineAt(pos);
    if (line.length >= 200 && line.text.includes(';base64,')) {
      for (const r of findDataUrlRanges(line.text, line.from)) out.push(Decoration.replace({ widget: new SizeWidget(r.bytes) }).range(r.from, r.to));
    }
    pos = line.to + 1;
  }
  return out;
}

export const dataUrlFoldField = StateField.define<DecorationSet>({
  create: (state) => Decoration.set(scan(state.doc, 0, state.doc.length)),
  update(deco, tr) {
    if (!tr.docChanged) return deco;
    let next = deco.map(tr.changes);
    // 只重扫改动碰到的那几行：整篇重扫的话，带着几 MB 图片的文档每敲一个字都要卡一下
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = tr.newDoc.lineAt(fromB).from;
      const to = tr.newDoc.lineAt(toB).to;
      next = next.update({ filterFrom: from, filterTo: to, filter: () => false, add: scan(tr.newDoc, from, to) });
    });
    return next;
  },
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
});

export const dataUrlFold = [dataUrlFoldField];
