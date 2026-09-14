import { describe, expect, it } from 'vitest';
import { renderNoteTemplate } from './noteTemplates';

describe('renderNoteTemplate', () => {
  it('替换日期 / 时间 / 标题变量，未知变量原样保留', () => {
    const d = new Date(2026, 8, 13, 9, 5); // 2026-09-13 09:05 星期日
    const out = renderNoteTemplate('# {{title}}\n{{date}} {{ weekday }} {{time}} {{year}}/{{month}}/{{day}} {{unknown}}', { title: '会议', date: d });
    expect(out).toBe('# 会议\n2026-09-13 星期日 09:05 2026/09/13 {{unknown}}');
  });
});
