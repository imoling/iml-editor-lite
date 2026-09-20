import { extractHeadings } from './outline';
import { splitFrontmatter } from '../../electron/shared/noteMeta';
import { findHeadingIndex } from '../../electron/shared/wikiLink';

export interface SectionRef {
  headings: string[];
  block: string | null;
}

/**
 * 从一篇笔记里取出链接指的那一部分（悬浮预览、嵌入共用）：
 *   没指定 → 去掉 frontmatter 的全文；
 *   #小节 → 从那个标题到下一个同级或更高级标题之前；
 *   #^块 → 以 `^块ID` 结尾的那一段（块 ID 本身不显示）。
 * 指定了但找不到返回 null，调用方据此提示「没有这一节」，而不是悄悄给全文。
 */
export function extractNoteSection(markdown: string, ref: SectionRef): string | null {
  const source = markdown || '';
  if (ref.block) return extractBlock(source, ref.block);
  if (ref.headings.length === 0) return splitFrontmatter(source).body;

  const headings = extractHeadings(source);
  const at = findHeadingIndex(headings, ref.headings);
  if (at === -1) return null;
  const lineOf = (i: number) => Number(headings[i].id.replace('heading-', ''));
  const lines = source.split('\n');
  let end = lines.length;
  for (let i = at + 1; i < headings.length; i++) {
    if (headings[i].level <= headings[at].level) { end = lineOf(i); break; }
  }
  return lines.slice(lineOf(at), end).join('\n').replace(/\s+$/, '');
}

/**
 * 把行尾的块标记（` ^abc123`）和单独占一行的块标记藏起来，给只读渲染用（嵌入、悬浮预览）：
 * 它是给链接定位用的记号，不是正文。围栏代码里的不动。只改要显示的副本，不碰文件。
 */
export function hideBlockIds(markdown: string): string {
  let fence: string | null = null;
  return markdown.split('\n').map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      return line;
    }
    if (fence) return line;
    if (/^\s*\^[A-Za-z0-9-]+\s*$/.test(line)) return '';
    return line.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/, '');
  }).join('\n');
}

const blockMarker = (id: string) => new RegExp(`(?:^|\\s)\\^${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`);

function extractBlock(source: string, id: string): string | null {
  const lines = source.split('\n');
  const marker = blockMarker(id);
  const at = lines.findIndex((l) => marker.test(l));
  if (at === -1) return null;
  // 块 ID 单独占一行时，它标的是上面那一块（表格、代码块、引用后面常这样写）
  let last = at;
  if (/^\s*\^/.test(lines[at])) {
    last = at - 1;
    while (last >= 0 && !lines[last].trim()) last--;
    if (last < 0) return null;
  }
  let first = last;
  while (first > 0 && lines[first - 1].trim()) first--;
  const picked = lines.slice(first, last + 1);
  picked[picked.length - 1] = picked[picked.length - 1].replace(marker, '');
  return picked.join('\n').replace(/\s+$/, '') || null;
}
