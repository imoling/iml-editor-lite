/**
 * 「快速打开」的匹配与排序（⌘T）。
 *
 * 目标用户里很多是从 Obsidian 过来的，习惯敲几个字就跳到笔记：
 * 连续子串优先（中文标题基本靠它），退一步接受按顺序出现的零散字符（英文文件名常用，如 "rdme" → README）。
 * 多个词用空格隔开，每个词都得匹配上；标题里没有的词可以落在文件夹路径上（如 "周会 项目"）。
 */

import { initialsOf } from './pinyinInitials';

export interface QuickOpenNote { path: string; title: string; aliases?: string[] }

export interface QuickOpenHit extends QuickOpenNote {
  /** 相对笔记库根目录的文件夹，根目录下为空串 */
  folder: string;
  score: number;
  /** 标题里命中的区间 [start, end)，用来高亮；命中的是文件名或路径时为空 */
  ranges: [number, number][];
  /** 靠 frontmatter 的别名才命中的：列表里把这个别名显示出来，不然用户看不出为什么是这篇 */
  alias?: string;
}

interface Match { score: number; ranges: [number, number][] }

const isBoundary = (text: string, at: number) => at === 0 || /[\s\-_/.·,，。:：()（）《》【】[\]]/.test(text[at - 1]);

/** 单个词对一段文本的匹配；匹配不上返回 null */
export function matchTerm(text: string, term: string): Match | null {
  if (!term) return { score: 0, ranges: [] };
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();

  // 连续子串：位置越靠前越好，落在词首再加分，整段相等最高
  const at = hay.indexOf(needle);
  if (at >= 0) {
    let score = 1000 - Math.min(at, 100) * 2;
    if (isBoundary(hay, at)) score += 150;
    if (at === 0) score += 100;
    if (hay.length === needle.length) score += 300;
    return { score, ranges: [[at, at + needle.length]] };
  }

  // 按顺序出现的零散字符：空隙越少越好，挨着的字符合并成一段高亮
  const ranges: [number, number][] = [];
  let from = 0;
  let gaps = 0;
  for (const ch of needle) {
    const found = hay.indexOf(ch, from);
    if (found < 0) return null;
    gaps += found - from;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === found) last[1] = found + 1;
    else ranges.push([found, found + 1]);
    from = found + 1;
  }
  return { score: Math.max(50, 400 - gaps * 8 - ranges.length * 20), ranges };
}

/**
 * 拼音首字母匹配：「xmzh」找到「项目周会」。只对纯英文数字、至少两个字符的词启用，且首字母必须连着出现——
 * 放得太宽的话，随便敲两个字母半个笔记库都能命中。分数压在直接命中之下：敲的就是标题里的英文时，英文那条排前面。
 */
export function matchInitials(text: string, term: string): Match | null {
  if (term.length < 2 || !/^[a-z0-9]+$/i.test(term) || !/[\u4e00-\u9fff]/.test(text)) return null;
  const initials = initialsOf(text);
  const at = initials.indexOf(term.toLowerCase());
  if (at < 0) return null;
  // 命中的那一段里至少要有一个汉字，不然就是普通的英文子串，轮不到这里管
  if (!/[\u4e00-\u9fff]/.test(text.slice(at, at + term.length))) return null;
  let score = 700 - Math.min(at, 100) * 2;
  if (isBoundary(initials, at)) score += 100;
  if (initials.trim().length === term.length) score += 150;
  return { score, ranges: [[at, at + term.length]] };
}

export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

const bestOf = (a: Match | null, b: Match | null): Match | null => (!a ? b : !b ? a : b.score > a.score ? b : a);

const baseName = (p: string) => (p.split(/[/\\]/).pop() || p).replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');

export function folderOf(path: string, root: string): string {
  const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
  const normRoot = root.replace(/[/\\]+$/, '');
  if (!normRoot || !dir.startsWith(normRoot)) return dir;
  return dir.slice(normRoot.length).replace(/^[/\\]+/, '');
}

/**
 * 排序结果。query 为空时列最近打开的（按最近程度），再接其余的（原顺序）。
 * recentPaths[0] 是最近打开的那篇。
 */
export function rankNotes(notes: QuickOpenNote[], query: string, opts: { root?: string; recentPaths?: string[]; limit?: number } = {}): QuickOpenHit[] {
  const { root = '', recentPaths = [], limit = 50 } = opts;
  const recency = new Map(recentPaths.map((p, i) => [p, i]));
  const terms = query.trim().split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    const hits = notes.map((n) => ({ ...n, folder: folderOf(n.path, root), score: 0, ranges: [] as [number, number][] }));
    const recent = hits.filter((h) => recency.has(h.path)).sort((a, b) => recency.get(a.path)! - recency.get(b.path)!);
    const rest = hits.filter((h) => !recency.has(h.path));
    return [...recent, ...rest].slice(0, limit);
  }

  const hits: QuickOpenHit[] = [];
  for (const note of notes) {
    const folder = folderOf(note.path, root);
    const file = baseName(note.path);
    let score = 0;
    const ranges: [number, number][] = [];
    let ok = true;
    let alias: string | undefined;
    for (const term of terms) {
      const onTitle = bestOf(matchTerm(note.title, term), matchInitials(note.title, term));
      // 标题（一级标题）和文件名可能不一样，两边都认；都没有再看文件夹路径，但分数打折
      const onFile = file !== note.title ? bestOf(matchTerm(file, term), matchInitials(file, term)) : null;
      const onFolder = folder ? matchTerm(folder, term) : null;
      // 别名和标题同等对待，但同分时让给标题
      let onAlias: Match | null = null;
      let aliasHit: string | undefined;
      for (const a of note.aliases || []) {
        const m = bestOf(matchTerm(a, term), matchInitials(a, term));
        if (m && (!onAlias || m.score > onAlias.score)) { onAlias = m; aliasHit = a; }
      }
      const best = Math.max(onTitle?.score ?? -1, onFile?.score ?? -1, onAlias?.score ?? -1, onFolder ? onFolder.score * 0.4 : -1);
      if (best < 0) { ok = false; break; }
      score += best;
      // 标题上连续命中的一段总是标出来（哪怕文件名那边分数更高）；零散字符拼出来的弱匹配只在它就是最优解时才标
      if (onTitle && (onTitle.score === best || onTitle.ranges.length === 1)) ranges.push(...onTitle.ranges);
      else if (onAlias && onAlias.score === best && (onFile?.score ?? -1) < best) alias = aliasHit;
    }
    if (!ok) continue;
    // 最近打开过的稍微往前提，但不足以压过明显更贴切的匹配
    const r = recency.get(note.path);
    if (r !== undefined) score += Math.max(0, 60 - r * 6);
    hits.push({ ...note, folder, score, ranges: mergeRanges(ranges), alias });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title)).slice(0, limit);
}
