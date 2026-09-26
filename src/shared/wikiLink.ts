/**
 * 双向链接目标的纯函数：主进程（反链、未链接提及）与渲染进程（打开、补全、预览、嵌入）共用。
 *
 * 认的写法与 Obsidian 一致：
 *   [[笔记]]  [[文件夹/笔记]]  [[笔记.md]]  [[笔记#小节]]  [[笔记#一级#二级]]  [[笔记#^块]]  [[#本篇的小节]]
 */

export interface WikiTarget {
  /** 笔记名或相对路径；`[[#小节]]` 指向本篇时为空串 */
  note: string;
  /** `#` 后面逐级的小节名 */
  headings: string[];
  /** `#^块ID` 里的块 ID */
  block: string | null;
}

export interface LinkableNote {
  path: string;
  title: string;
  aliases?: string[];
}

const NOTE_EXT_RE = /\.(md|markdown|mdown|mkd|txt)$/i;

export function parseWikiTarget(target: string): WikiTarget {
  const [note, ...rest] = (target || '').split('#');
  const out: WikiTarget = { note: note.trim().replace(NOTE_EXT_RE, ''), headings: [], block: null };
  for (const part of rest) {
    const p = part.trim();
    if (!p) continue;
    if (p.startsWith('^')) out.block = p.slice(1).trim() || null;
    else out.headings.push(p);
  }
  return out;
}

export const noteBaseName = (filePath: string) => (filePath.split(/[/\\]/).pop() || '').replace(NOTE_EXT_RE, '');

/** 这篇笔记能被哪些名字链到：文件名、一级标题、frontmatter 的 aliases（去重，保留原大小写） */
export function noteNames(note: LinkableNote): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [noteBaseName(note.path), note.title, ...(note.aliases || [])]) {
    const n = (name || '').trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

/** name 是不是指这篇笔记。带 `/` 的按路径结尾比对（`项目/周会` 命中 `…/项目/周会.md`） */
export function matchesNoteName(note: LinkableNote, name: string): boolean {
  const n = name.trim().replace(NOTE_EXT_RE, '').toLowerCase();
  if (!n) return false;
  if (/[/\\]/.test(n)) {
    const wanted = '/' + n.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = '/' + note.path.replace(/\\/g, '/').replace(NOTE_EXT_RE, '').toLowerCase().replace(/^\/+/, '');
    return full.endsWith(wanted);
  }
  return noteNames(note).some((x) => x.toLowerCase() === n);
}

export interface ResolvedWikiTarget extends WikiTarget {
  /** 命中的笔记；库里没有时为 null */
  hit: LinkableNote | null;
}

/**
 * 在笔记列表里找链接指向的那一篇。同名时优先 currentDir 下的。
 * 先拿整串去比：一级标题本身带 `#` 的笔记（「C# 入门」）不能被拆成「C」+ 小节。
 */
export function resolveWikiTarget(notes: LinkableNote[], target: string, currentDir?: string | null): ResolvedWikiTarget {
  const raw = (target || '').trim();
  const pick = (name: string) => {
    const candidates = notes.filter((n) => matchesNoteName(n, name));
    if (candidates.length < 2 || !currentDir) return candidates[0] ?? null;
    const dir = currentDir.replace(/[/\\]+$/, '');
    return candidates.find((n) => n.path.startsWith(dir + '/') || n.path.startsWith(dir + '\\')) ?? candidates[0];
  };
  if (raw.includes('#') && !raw.startsWith('#')) {
    const whole = pick(raw);
    if (whole) return { note: raw.replace(NOTE_EXT_RE, ''), headings: [], block: null, hit: whole };
  }
  const parsed = parseWikiTarget(raw);
  return { ...parsed, hit: parsed.note ? pick(parsed.note) : null };
}

/** 小节名比对用：忽略大小写、多余空白，以及 Obsidian 在链接里会吞掉的几个符号 */
export const normalizeHeading = (text: string) => (text || '').toLowerCase().replace(/[#|^:%[\]]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 在一篇笔记的标题序列里找 `#一级#二级` 指的那一个，返回下标；找不到返回 -1。
 * 逐级往下找（二级必须出现在一级之后、且层级更深）；对不上就退回「最后一级的名字第一次出现的地方」。
 */
export function findHeadingIndex(headings: { level: number; text: string }[], path: string[]): number {
  const wanted = path.map(normalizeHeading).filter(Boolean);
  if (wanted.length === 0) return -1;
  let from = 0;
  let minLevel = 0;
  let found = -1;
  for (const name of wanted) {
    found = -1;
    for (let i = from; i < headings.length; i++) {
      if (minLevel && headings[i].level <= minLevel) break; // 走出了上一级的范围
      if (headings[i].level > minLevel && normalizeHeading(headings[i].text) === name) { found = i; break; }
    }
    if (found === -1) break;
    minLevel = headings[found].level;
    from = found + 1;
  }
  if (found !== -1) return found;
  const last = wanted[wanted.length - 1];
  return headings.findIndex((h) => normalizeHeading(h.text) === last);
}

/**
 * 把原文里的一处「未链接提及」改写成链接。位置是索引给的，那篇笔记之后可能又被改过：
 * 位置上的字对不上、或者那里已经在 [[ ]] 里了，就返回 null，调用方什么都不要写。
 * 提及的字和文件名一样写成 [[文件名]]，否则写成 [[文件名|原来的字]]——Obsidian 只认文件名，这样两边都能用。
 */
export function linkifyMention(content: string, offset: number, length: number, match: string, targetName: string): string | null {
  if (offset < 0 || length <= 0 || content.slice(offset, offset + length) !== match) return null;
  const openAt = content.lastIndexOf('[[', offset);
  if (openAt !== -1) {
    const closeAt = content.indexOf(']]', openAt);
    const lineBreak = content.indexOf('\n', openAt);
    if (closeAt !== -1 && closeAt >= offset && (lineBreak === -1 || lineBreak > closeAt)) return null;
  }
  const link = match.toLowerCase() === targetName.toLowerCase() ? `[[${match}]]` : `[[${targetName}|${match}]]`;
  return content.slice(0, offset) + link + content.slice(offset + length);
}
