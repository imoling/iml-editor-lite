/**
 * 富文本 → Markdown 时对正文的转义。
 * turndown 自带的规则是「见到就转义」：my_var 变 my\_var、[1] 变 \[1\]、C:\Users 变 C:\\Users，
 * 每保存一次就把别的工具写的笔记改花一次。这里只在字符真的会被解析成语法时才转义。
 */

const WORD = /[\p{L}\p{N}]/u;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

/** 这段文本里的方括号会不会被解析成链接 / 图片 / 引用式链接 / 链接定义 */
function bracketsAreRisky(text: string): boolean {
  return /\[[^\]\n]*\]\s?[([:]/.test(text) || /^\s*\[[ xX]\]/.test(text);
}

function escapeSegment(text: string, atStart: boolean): string {
  const risky = bracketsAreRisky(text);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    const next = i + 1 < text.length ? text[i + 1] : '';
    switch (ch) {
      case '\\':
        // 反斜杠只有在后面跟着可转义的标点（或位于末尾，可能和下一个节点拼起来）时才有语法含义
        out += !next || ASCII_PUNCT.test(next) ? '\\\\' : ch;
        break;
      case '*': {
        // 两边都是空白的 * 不可能构成强调；其余一律转义
        const spaced = (!prev || /\s/.test(prev)) && (!next || /\s/.test(next));
        out += spaced && !(atStart && i === 0) ? ch : '\\*';
        break;
      }
      case '_':
        // 词内下划线（snake_case、中文之间）不会触发强调
        out += prev && next && WORD.test(prev) && WORD.test(next) ? ch : '\\_';
        break;
      case '`':
        out += '\\`';
        break;
      case '[':
      case ']':
        out += risky ? `\\${ch}` : ch;
        break;
      case '<':
        // 只有像标签 / 注释 / 自动链接的写法才需要转义；a < b 不动
        out += /[A-Za-z/!?]/.test(next) ? '\\<' : ch;
        break;
      case '&':
        out += /^&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.test(text.slice(i)) ? '\\&' : ch;
        break;
      case '~':
        out += next === '~' || prev === '~' ? '\\~' : ch;
        break;
      default:
        out += ch;
    }
  }
  if (!atStart) return out;
  // 行首语法：列表、标题、引用、Setext 下划线、围栏
  return out
    .replace(/^(\s*)-(?=(?:\s*-){2,}\s*$)/, '$1\\-') // 单独一行的 --- 会变成分割线
    .replace(/^(\s*)-(?=\s|$)/, '$1\\-')
    .replace(/^(\s*)\+(?=\s)/, '$1\\+')
    .replace(/^(\s*)(=+)\s*$/, '$1\\$2')
    .replace(/^(\s*)(#{1,6})(?=\s)/, '$1\\$2')
    .replace(/^(\s*)>/, '$1\\>')
    .replace(/^(\s*)(\d+)([.)])(?=\s)/, '$1$2\\$3');
}

/**
 * turndown 逐个文本节点调用转义函数，只给字符串、不给节点。段落中间的文本节点（比如 <kbd>⌘</kbd> + <kbd>S</kbd> 里的 " + "）
 * 并不在行首，行首规则不该对它生效。htmlToMarkdown 在转换前给这类节点的开头加上这个标记，这里认到就跳过行首规则。
 */
export const MID_LINE_MARK = '\u2060\u2060';
/** 文本开头像不像行首语法（只有这种才需要打标记） */
export const LINE_START_SENSITIVE = /^\s*(?:[-+>]|#{1,6}\s|\d+[.)]\s|=+\s*$)/;

/** `$…$` 行内公式：内部原样保留（由 inlineMath 节点负责；这里兜底处理没被识别成节点的情况） */
const INLINE_MATH = /\$(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\d)/g;

export function escapeMarkdown(input: string): string {
  if (!input) return input;
  const midLine = input.startsWith(MID_LINE_MARK);
  const text = midLine ? input.slice(MID_LINE_MARK.length) : input;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(INLINE_MATH)) {
    const idx = m.index ?? 0;
    out += escapeSegment(text.slice(last, idx), last === 0 && !midLine) + m[0];
    last = idx + m[0].length;
  }
  return out + escapeSegment(text.slice(last), last === 0 && !midLine);
}
