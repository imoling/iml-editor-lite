import { describe, expect, it } from 'vitest';
import { diffLines, diffStats, collapseContext } from './lineDiff';

describe('diffLines', () => {
  it('标出新增与删除的行，未改动的保持原样', () => {
    const ops = diffLines('甲\n乙\n丙\n丁', '甲\n乙改\n丙\n丁\n戊');
    expect(ops).toEqual([
      { type: 'same', text: '甲' },
      { type: 'del', text: '乙' },
      { type: 'add', text: '乙改' },
      { type: 'same', text: '丙' },
      { type: 'same', text: '丁' },
      { type: 'add', text: '戊' },
    ]);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 1 });
  });

  it('相同内容没有改动；从空到有全是新增', () => {
    expect(diffStats(diffLines('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0 });
    expect(diffLines('', 'x').filter((o) => o.type === 'add').map((o) => o.text)).toEqual(['x']);
  });

  it('按新文本重放 diff 能还原出新文本', () => {
    const oldText = '一\n二\n三\n四\n五\n六';
    const newText = '零\n一\n三\n四改\n五\n六\n七';
    const rebuilt = diffLines(oldText, newText).filter((o) => o.type !== 'del').map((o) => o.text).join('\n');
    expect(rebuilt).toBe(newText);
  });

  it('长段未改动内容折叠成 gap', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `行${i}`);
    const changed = [...lines];
    changed[20] = '改了';
    const rows = collapseContext(diffLines(lines.join('\n'), changed.join('\n')), 2);
    expect(rows[0]).toEqual({ type: 'gap', count: 18 });
    expect(rows.filter((r) => r.type === 'gap')).toHaveLength(2);
    expect(rows.filter((r) => r.type === 'same')).toHaveLength(4);
  });
});
