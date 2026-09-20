import { describe, expect, it } from 'vitest';
import { appendCapture, captureEntry, toAccelerator, displayAccelerator } from './capture';
import { renderNoteTemplate, DEFAULT_DAILY_TEMPLATE } from './noteTemplates';

const at = new Date(2026, 8, 20, 14, 5);

describe('captureEntry', () => {
  it('带上时间；多行的后几行缩进两格，首尾空行去掉', () => {
    expect(captureEntry('给客户回邮件', at)).toBe('- 14:05 给客户回邮件');
    expect(captureEntry('\n  第一行  \n第二行\n\n第四行\n\n', at)).toBe('- 14:05 第一行\n  第二行\n\n  第四行');
    expect(captureEntry('   \n ', at)).toBe('');
  });
});

describe('appendCapture', () => {
  it('内置日记模板：写在末尾的「想法」一节下面；连着记几条连成一个列表', () => {
    const daily = renderNoteTemplate(DEFAULT_DAILY_TEMPLATE, { date: at });
    const once = appendCapture(daily, '第一条', at)!;
    expect(once).toBe(daily.replace(/\s+$/, '') + '\n\n- 14:05 第一条\n');
    expect(once.startsWith('# 2026-09-20 星期日\n\n## 今天\n\n- \n\n## 想法')).toBe(true);
    const twice = appendCapture(once, '第二条\n续一行', new Date(2026, 8, 20, 14, 6))!;
    expect(twice.endsWith('## 想法\n\n- 14:05 第一条\n- 14:06 第二条\n  续一行\n')).toBe(true);
    // 上一条是多行的：末尾是缩进的续行，下一条照样接着写
    expect(appendCapture(twice, '第三条', at)!.endsWith('  续一行\n- 14:05 第三条\n')).toBe(true);
  });

  it('末尾是正文、标题或模板里的空列表项：隔一个空行', () => {
    expect(appendCapture('# 日记\n\n一段话。', '记一句', at)).toBe('# 日记\n\n一段话。\n\n- 14:05 记一句\n');
    // 模板里的空列表项原样留着（连 `- ` 后面那个空格），新记录另起一段
    expect(appendCapture('# 日记\n\n- \n', '记一句', at)).toBe('# 日记\n\n- \n\n- 14:05 记一句\n');
    expect(appendCapture('# 日记\n\n一段话，行尾有空格  \n\n\n', '记一句', at)).toBe('# 日记\n\n一段话，行尾有空格  \n\n- 14:05 记一句\n');
  });

  it('空文件、空内容、Windows 换行', () => {
    expect(appendCapture('', '记一句', at)).toBe('- 14:05 记一句\n');
    expect(appendCapture('\n  \n', '记一句', at)).toBe('- 14:05 记一句\n');
    expect(appendCapture('# 日记\n', '  \n ', at)).toBeNull();
    expect(appendCapture('# 日记\r\n\r\n一段话。\r\n', '两行\n第二行', at)).toBe('# 日记\r\n\r\n一段话。\r\n\r\n- 14:05 两行\r\n  第二行\r\n');
  });
});

describe('全局快捷键', () => {
  const ev = (o: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string }>) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: '', ...o });
  it('按键 → Electron 的写法；没有 Ctrl / Alt / Cmd 的、只按了修饰键的不成立', () => {
    expect(toAccelerator(ev({ ctrlKey: true, altKey: true, code: 'KeyN' }))).toBe('Control+Alt+N');
    expect(toAccelerator(ev({ metaKey: true, shiftKey: true, code: 'Space' }))).toBe('Shift+Command+Space');
    expect(toAccelerator(ev({ altKey: true, code: 'Digit1' }))).toBe('Alt+1');
    expect(toAccelerator(ev({ ctrlKey: true, code: 'F5' }))).toBe('Control+F5');
    expect(toAccelerator(ev({ shiftKey: true, code: 'KeyN' }))).toBeNull();
    expect(toAccelerator(ev({ code: 'KeyN' }))).toBeNull();
    expect(toAccelerator(ev({ ctrlKey: true, code: 'ControlLeft' }))).toBeNull();
  });
  it('显示：mac 用符号，别的平台用文字', () => {
    expect(displayAccelerator('Control+Alt+N', true)).toBe('⌃⌥N');
    expect(displayAccelerator('Control+Alt+N', false)).toBe('Ctrl+Alt+N');
    expect(displayAccelerator('Shift+Command+Space', true)).toBe('⇧⌘Space');
  });
});
