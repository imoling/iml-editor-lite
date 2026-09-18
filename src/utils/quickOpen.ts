/**
 * 「快速打开」的匹配与排序（⌘T）。
 *
 * 目标用户里很多是从 Obsidian 过来的，习惯敲几个字就跳到笔记：
 * 连续子串优先（中文标题基本靠它），退一步接受按顺序出现的零散字符（英文文件名常用，如 "rdme" → README）。
 * 多个词用空格隔开，每个词都得匹配上；标题里没有的词可以落在文件夹路径上（如 "周会 项目"）。
 */

export interface QuickOpenNote { path: string; title: string }

export interface QuickOpenHit extends QuickOpenNote {
  /** 相对笔记库根目录的文件夹，根目录下为空串 */
  folder: string;
  score: number;
  /** 标题里命中的区间 [start, end)，用来高亮；命中的是文件名或路径时为空 */
  ranges: [number, number][];
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

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

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
    for (const term of terms) {
      const onTitle = matchTerm(note.title, term);
      // 标题（一级标题）和文件名可能不一样，两边都认；都没有再看文件夹路径，但分数打折
      const onFile = file !== note.title ? matchTerm(file, term) : null;
      const onFolder = folder ? matchTerm(folder, term) : null;
      const best = Math.max(onTitle?.score ?? -1, onFile?.score ?? -1, onFolder ? onFolder.score * 0.4 : -1);
      if (best < 0) { ok = false; break; }
      score += best;
      if (onTitle && onTitle.score === best) ranges.push(...onTitle.ranges);
    }
    if (!ok) continue;
    // 最近打开过的稍微往前提，但不足以压过明显更贴切的匹配
    const r = recency.get(note.path);
    if (r !== undefined) score += Math.max(0, 60 - r * 6);
    hits.push({ ...note, folder, score, ranges: mergeRanges(ranges) });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title)).slice(0, limit);
}
