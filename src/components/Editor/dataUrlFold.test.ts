import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { dataUrlFold, dataUrlFoldField, findDataUrlRanges } from './dataUrlFold';

const B64 = 'QUJD'.repeat(100); // 400 个字符 = 300 字节
const image = (alt = '图') => `![${alt}](data:image/webp;base64,${B64})`;

function folded(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  state.field(dataUrlFoldField).between(0, state.doc.length, (from, to) => { out.push({ from, to }); });
  return out;
}

describe('源码模式：写进文档里的图片折起来', () => {
  it('只折 base64 那一长串，前面的 data:image/webp;base64, 留着；大小按字节算', () => {
    const text = `前面 ${image()} 后面`;
    const [range] = findDataUrlRanges(text);
    expect(text.slice(0, range.from).endsWith('data:image/webp;base64,')).toBe(true);
    expect(text.slice(range.from, range.to)).toBe(B64);
    expect(range.bytes).toBe(300);
    expect(findDataUrlRanges(text, 1000)[0].from).toBe(range.from + 1000);
  });

  it('短的（小图标）不折；不是图片的 data: 地址不折；一行里有几张就折几处', () => {
    expect(findDataUrlRanges('![](data:image/png;base64,AAAA)')).toEqual([]);
    expect(findDataUrlRanges(`data:text/plain;base64,${B64}`)).toEqual([]);
    expect(findDataUrlRanges(`${image('甲')} ${image('乙')}`)).toHaveLength(2);
  });

  it('改别的行不重扫也不丢；改到图片所在的行，位置跟着走；把图片删了，折叠也没了', () => {
    let state = EditorState.create({ doc: `# 标题\n\n${image()}\n\n结尾`, extensions: dataUrlFold });
    const before = folded(state);
    expect(before).toHaveLength(1);

    state = state.update({ changes: { from: 0, insert: '新的一行\n' } }).state;
    expect(folded(state)).toEqual([{ from: before[0].from + 5, to: before[0].to + 5 }]);
    expect(state.doc.sliceString(folded(state)[0].from, folded(state)[0].to)).toBe(B64);

    const line = state.doc.lineAt(folded(state)[0].from);
    state = state.update({ changes: { from: line.from, insert: '看图：' } }).state;
    expect(state.doc.sliceString(folded(state)[0].from, folded(state)[0].to)).toBe(B64);

    const again = state.doc.lineAt(folded(state)[0].from);
    state = state.update({ changes: { from: again.from, to: again.to, insert: '图没了' } }).state;
    expect(folded(state)).toEqual([]);
  });
});
