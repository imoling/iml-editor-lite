import { extractHeadings } from './outline';
import { LinkableNote, noteBaseName, resolveWikiTarget } from '../../electron/shared/wikiLink';

export interface WikiHeadingCandidate {
  /** 写进 [[ ]] 的完整目标：`笔记#小节`，本篇内是 `#小节` */
  target: string;
  heading: string;
  level: number;
  path: string;
}

export interface WikiCompleteContext {
  /** 正在编辑的笔记：`[[#` 列它自己的小节；同名笔记优先取它旁边的 */
  currentPath: string | null;
  currentContent: string;
  /** 读一篇笔记的原文（已打开的标签页优先用标签页里的，没存盘的改动也算） */
  readNote: (path: string) => Promise<string | null>;
}

/**
 * `[[笔记#` 之后补全那篇笔记的小节。query 里没有 `#` 返回 null，交回给笔记名补全。
 */
export async function wikiHeadingCandidates(notes: LinkableNote[], query: string, ctx: WikiCompleteContext, limit = 12): Promise<WikiHeadingCandidate[] | null> {
  const hashAt = query.indexOf('#');
  if (hashAt === -1) return null;
  const noteName = query.slice(0, hashAt).trim();
  const wanted = query.slice(hashAt + 1).trim().toLowerCase();
  if (wanted.startsWith('^')) return []; // 块 ID 没法列

  let path = ctx.currentPath || '';
  let content: string | null = ctx.currentContent;
  if (noteName) {
    const dir = ctx.currentPath ? ctx.currentPath.slice(0, Math.max(ctx.currentPath.lastIndexOf('/'), ctx.currentPath.lastIndexOf('\\'))) : null;
    const hit = resolveWikiTarget(notes, noteName, dir).hit;
    if (!hit) return [];
    path = hit.path;
    content = hit.path === ctx.currentPath ? ctx.currentContent : await ctx.readNote(hit.path);
  }
  if (content == null) return [];
  return extractHeadings(content)
    .filter((h) => !wanted || h.text.toLowerCase().includes(wanted))
    .slice(0, limit)
    .map((h) => ({ target: `${noteName}#${h.text}`, heading: h.text, level: h.level, path }));
}

/** 补全列表里用文件名当候选（[[ ]] 里习惯写文件名，Obsidian 也只认文件名），别名跟着带上 */
export const toNameCandidates = (notes: LinkableNote[]) => notes.map((n) => ({ ...n, title: noteBaseName(n.path) || n.title }));
