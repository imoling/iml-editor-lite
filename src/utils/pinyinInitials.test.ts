import { describe, expect, it } from 'vitest';
import { initialOf, initialsOf } from './pinyinInitials';

describe('拼音首字母', () => {
  it('常用字的首字母都对：每个声母各抽几个字', () => {
    const cases: Record<string, string> = {
      a: '阿爱安', b: '八白本', c: '才从错', d: '大的对', e: '二而恶', f: '发方分', g: '个工过', h: '好和会',
      j: '就记家', k: '开看可', l: '了来里', m: '们没目', n: '你年能', o: '哦欧偶', p: '怕平片', q: '去前全',
      r: '人日如', s: '是上说', t: '他天头', w: '我为文', x: '下小项', y: '一有要', z: '在这中周',
    };
    for (const [letter, chars] of Object.entries(cases)) {
      for (const ch of chars) expect(`${ch}:${initialOf(ch)}`).toBe(`${ch}:${letter}`);
    }
  });

  it('和原文等长、一一对应：汉字 → 首字母，英文数字 → 小写，标点空白 → 空格', () => {
    expect(initialsOf('项目周会')).toBe('xmzh');
    expect(initialsOf('2026 周会-Notes')).toBe('2026 zh notes');
    expect(initialsOf('读书笔记：《原则》')).toBe('dsbj  yz ');
    const mixed = '会议😀记录';
    expect(initialsOf(mixed)).toHaveLength(mixed.length);
    expect(initialsOf(mixed).replace(/ /g, '')).toBe('hyjl');
  });

  it('不是汉字的返回空串', () => {
    expect([initialOf('a'), initialOf('1'), initialOf('。'), initialOf('')]).toEqual(['', '', '', '']);
  });
});
