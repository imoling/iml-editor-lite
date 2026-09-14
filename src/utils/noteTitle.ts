const MAX_TITLE_LENGTH = 30;

/** 围栏 / 公式 / 分隔线 / 表格分隔行 / 注释：这些行本身不是标题素材 */
const SKIP_LINE = /^(:::|\$\$|```|~~~|---+\s*$|\*\*\*+\s*$|___+\s*$|<!--|\|?\s*:?-{2,}:?\s*(\||$))/;

/**
 * 从 Markdown 内容里推一个可用作文件名的标题：取第一行有实际文字的内容，去掉标题井号、
 * 列表 / 引用 / 任务标记、加粗斜体、链接语法与文件名非法字符。找不到有文字的行时返回 null，
 * 让调用方决定是等一等还是用时间戳。
 */
export function deriveNoteTitle(markdown: string): string | null {
  for (const raw of (markdown || '').split('\n').slice(0, 60)) {
    let line = raw.trim();
    if (!line || SKIP_LINE.test(line)) continue;
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s*/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => label || target)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_~`$>|]/g, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // 至少要有一个字母 / 数字 / 汉字，纯符号（如 $$、---）不算
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    return line.slice(0, MAX_TITLE_LENGTH).trim().replace(/[. ]+$/, '') || null;
  }
  return null;
}
