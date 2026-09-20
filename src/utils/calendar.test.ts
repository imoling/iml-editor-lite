import { describe, expect, it } from 'vitest';
import { monthGrid, shiftMonth, dailyNotesByDate } from './calendar';

describe('monthGrid', () => {
  it('周一打头、固定 6 行 7 列，前后用相邻月份补齐', () => {
    const grid = monthGrid(2026, 8); // 2026 年 9 月：1 号是周二
    expect(grid).toHaveLength(6);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0].map((d) => d.key)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(grid[0].map((d) => d.inMonth)).toEqual([false, true, true, true, true, true, true]);
    expect(grid.flat().filter((d) => d.inMonth)).toHaveLength(30);
    expect(grid.flat().every((d, i, all) => i === 0 || d.date.getTime() > all[i - 1].date.getTime())).toBe(true);
  });

  it('1 号正好是周一的月份不空出一整行；1 号是周日的月份前面补 6 天', () => {
    expect(monthGrid(2026, 5)[0][0].key).toBe('2026-06-01'); // 2026-06-01 周一
    const feb = monthGrid(2026, 1); // 2026-02-01 周日
    expect(feb[0].map((d) => d.inMonth)).toEqual([false, false, false, false, false, false, true]);
    expect(feb[0][6].key).toBe('2026-02-01');
  });

  it('闰年 2 月有 29 天', () => {
    expect(monthGrid(2028, 1).flat().filter((d) => d.inMonth)).toHaveLength(29);
  });
});

describe('shiftMonth', () => {
  it('跨年进位', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 8, -14)).toEqual({ year: 2025, month: 6 });
  });
});

describe('dailyNotesByDate', () => {
  const notes = [
    { path: '/lib/日记/2026-09-20.md' },
    { path: '/lib/日记/2026/09/2026-09-19.md' },
    { path: '/lib/日记/2026/09/2026-09-20.md' },
    { path: '/lib/日记/随想.md' },
    { path: '/lib/日记/2026-02-31.md' },
    { path: '/lib/项目/2026-09-18.md' },
    { path: '/lib/日记本/2026-09-17.md' },
  ];
  it('只认 日记/ 下面（含子文件夹）文件名是真实日期的；同一天取直接放在 日记/ 下的那篇', () => {
    const map = dailyNotesByDate(notes, '/lib');
    expect([...map.keys()].sort()).toEqual(['2026-09-19', '2026-09-20']);
    expect(map.get('2026-09-20')).toBe('/lib/日记/2026-09-20.md');
  });
  it('Windows 路径；笔记库根带不带结尾分隔符都行；没有笔记库时为空', () => {
    expect([...dailyNotesByDate([{ path: 'C:\\lib\\日记\\2026-09-20.md' }], 'C:\\lib\\').keys()]).toEqual(['2026-09-20']);
    expect(dailyNotesByDate(notes, '').size).toBe(0);
  });
});
