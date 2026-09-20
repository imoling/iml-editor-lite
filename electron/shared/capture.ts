/**
 * 快速捕获：把随手记下的一句话追加到日记末尾。纯函数，主进程（主窗口不在时自己写盘）与渲染进程共用。
 */
import { formatTime } from './date';

/** 一条记录：`- 14:32 内容`；多行内容的后几行缩进两格，仍属于同一个列表项 */
export function captureEntry(text: string, now: Date): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return '';
  return [`- ${formatTime(now)} ${lines[0].trim()}`, ...lines.slice(1).map((l) => (l.trim() ? `  ${l.trim()}` : ''))].join('\n');
}

/**
 * 追加到笔记末尾。紧跟在上一条记录（列表项）后面时不空行，连成一个列表；前面是别的内容就隔一个空行。
 * 文件原来用 \r\n 就跟着用。内容是空白时返回 null，调用方什么都不要写。
 */
export function appendCapture(content: string, text: string, now: Date): string | null {
  const entry = captureEntry(text, now);
  if (!entry) return null;
  const eol = /\r\n/.test(content) ? '\r\n' : '\n';
  // 只去掉末尾的空行；最后一行有内容的话一个字符都不动（模板里的占位 `- ` 后面那个空格也留着）
  const body = (content || '').replace(/(?:\r?\n[ \t]*)+$/, '');
  if (!body.trim()) return entry.replace(/\n/g, eol) + eol;
  const lastLine = body.slice(body.lastIndexOf('\n') + 1);
  // 末尾是列表项或它的续行（缩进的）：接着写；`- ` 后面什么都没有的空项（模板里的占位）不算
  const inList = /^\s*[-*+]\s+\S/.test(lastLine) || /^\s{2,}\S/.test(lastLine);
  return body + eol + (inList ? '' : eol) + entry.replace(/\n/g, eol) + eol;
}

/** 渲染层按键 → Electron 的全局快捷键写法（Control+Alt+N）。不成立的组合返回 null：必须带 Ctrl / Alt / Cmd 之一，光有 Shift 不行 */
export function toAccelerator(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string }): string | null {
  let key = '';
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  else if (e.code === 'Space') key = 'Space';
  if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
  return [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command', key].filter(Boolean).join('+');
}

/** 给人看的写法：mac 用符号（⌃⌥N），别的平台用 Ctrl+Alt+N */
export function displayAccelerator(accelerator: string, isMac: boolean): string {
  const parts = (accelerator || '').split('+').filter(Boolean);
  if (!isMac) return parts.map((p) => (p === 'Control' ? 'Ctrl' : p === 'Command' ? 'Win' : p)).join('+');
  const symbol: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' };
  return parts.map((p) => symbol[p] ?? p).join('');
}

export const DEFAULT_CAPTURE_SHORTCUT = 'Control+Alt+N';
