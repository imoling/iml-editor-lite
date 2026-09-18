import fs from 'fs';
import path from 'path';
import { splitFrontmatter, extractTags, tagMatches } from './shared/noteMeta';

/**
 * 笔记库全文索引（纯 JS，常驻主进程内存）。
 * 几千篇笔记量级下线性扫描已经足够快，且中文不需要分词器；后续要上向量 / FTS 再换实现。
 */
export interface IndexedNote {
  path: string;
  title: string;
  content: string;
  /** 小写副本，用于不区分大小写匹配 */
  lower: string;
  mtime: number;
  /** frontmatter 的 tags 与正文里的 #标签 */
  tags: string[];
}

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  path: string;
  title: string;
  count: number;
  score: number;
  snippets: SearchSnippet[];
}

const NOTE_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const SNIPPET_RADIUS = 48;
const MAX_SNIPPETS = 3;

export class SearchIndex {
  private notes = new Map<string, IndexedNote>();
  private root: string | null = null;
  private building = false;
  private buildId = 0;

  status() {
    return { root: this.root, count: this.notes.size, building: this.building };
  }

  async build(root: string): Promise<void> {
    const id = ++this.buildId;
    this.root = root;
    this.building = true;
    this.notes.clear();
    try {
      await this.walk(root, id);
    } finally {
      if (id === this.buildId) this.building = false;
    }
  }

  private async walk(dir: string, id: number): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (id !== this.buildId) return; // 已开始新一轮构建
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await this.walk(full, id);
      else if (entry.isFile() && NOTE_RE.test(entry.name)) await this.addFile(full);
    }
  }

  async addFile(filePath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return;
      const content = await fs.promises.readFile(filePath, 'utf8');
      this.notes.set(filePath, {
        path: filePath,
        title: SearchIndex.titleOf(filePath, content),
        content,
        lower: content.toLowerCase(),
        mtime: stat.mtimeMs,
        tags: extractTags(content),
      });
    } catch {
      this.notes.delete(filePath);
    }
  }

  static titleOf(filePath: string, content: string): string {
    // 跳过 frontmatter：YAML 里的 `# 注释` 不是一级标题
    const m = splitFrontmatter(content).body.match(/^\s*#\s+(.+?)\s*$/m);
    if (m) return m[1].replace(/[*_`]/g, '').trim();
    return path.basename(filePath).replace(NOTE_RE, '');
  }

  remove(target: string) {
    this.notes.delete(target);
    const prefix = target + path.sep;
    for (const key of [...this.notes.keys()]) {
      if (key.startsWith(prefix)) this.notes.delete(key);
    }
  }

  /** 目录监听给到的变更路径：文件 → 重读；目录 → 重扫并清掉已消失的条目；不存在 → 移除 */
  async refresh(paths: string[]): Promise<void> {
    for (const p of paths) {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(p);
      } catch {
        this.remove(p);
        continue;
      }
      if (stat.isDirectory()) {
        const prefix = p + path.sep;
        const before = [...this.notes.keys()].filter((k) => k.startsWith(prefix));
        await this.walk(p, this.buildId);
        for (const key of before) {
          if (!fs.existsSync(key)) this.notes.delete(key);
        }
      } else if (NOTE_RE.test(p)) {
        await this.addFile(p);
      }
    }
  }

  listNotes(): { path: string; title: string }[] {
    return [...this.notes.values()].map((n) => ({ path: n.path, title: n.title })).sort((a, b) => a.title.localeCompare(b.title));
  }

  /** 全库标签及篇数；层级标签 a/b 同时计入父标签 a */
  listTags(): { tag: string; count: number }[] {
    const counts = new Map<string, { tag: string; notes: Set<string> }>();
    for (const note of this.notes.values()) {
      for (const tag of note.tags) {
        const parts = tag.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const name = parts.slice(0, i).join('/');
          const key = name.toLowerCase();
          if (!counts.has(key)) counts.set(key, { tag: name, notes: new Set() });
          counts.get(key)!.notes.add(note.path);
        }
      }
    }
    return [...counts.values()]
      .map((c) => ({ tag: c.tag, count: c.notes.size }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
  }

  /** 带某个标签（或其子标签）的笔记，最近修改的在前 */
  notesByTag(tag: string): { path: string; title: string; tags: string[]; mtime: number }[] {
    return [...this.notes.values()]
      .filter((n) => n.tags.some((t) => tagMatches(t, tag)))
      .sort((a, b) => b.mtime - a.mtime)
      .map((n) => ({ path: n.path, title: n.title, tags: n.tags, mtime: n.mtime }));
  }

  /** 给定路径的原文与修改时间（语义索引用；不在索引里返回 null） */
  getNote(filePath: string): IndexedNote | null {
    return this.notes.get(filePath) ?? null;
  }

  allNotes(): IndexedNote[] {
    return [...this.notes.values()];
  }

  /** 多个词以空格分隔时要求全部命中；片段按第一个词截取 */
  search(query: string, limit = 50): SearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const results: SearchResult[] = [];
    for (const note of this.notes.values()) {
      if (!terms.every((t) => note.lower.includes(t))) continue;
      let count = 0;
      const snippets: SearchSnippet[] = [];
      const first = terms[0];
      let idx = note.lower.indexOf(first);
      while (idx !== -1 && count < 200) {
        count++;
        if (snippets.length < MAX_SNIPPETS) {
          const start = Math.max(0, idx - SNIPPET_RADIUS);
          const end = Math.min(note.content.length, idx + first.length + SNIPPET_RADIUS);
          snippets.push({
            before: (start > 0 ? '…' : '') + note.content.slice(start, idx).replace(/\s+/g, ' '),
            match: note.content.slice(idx, idx + first.length),
            after: note.content.slice(idx + first.length, end).replace(/\s+/g, ' ') + (end < note.content.length ? '…' : ''),
          });
        }
        idx = note.lower.indexOf(first, idx + first.length);
      }
      const titleHit = terms.every((t) => note.title.toLowerCase().includes(t)) ? 10 : 0;
      results.push({ path: note.path, title: note.title, count, score: titleHit + Math.min(count, 20), snippets });
    }
    return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  }

  /** 哪些笔记用 [[title]] 或 [[title|别名]] 链到了这篇 */
  backlinks(title: string): { path: string; title: string; snippets: SearchSnippet[] }[] {
    const needle = `[[${title}`;
    const lowerNeedle = needle.toLowerCase();
    const out: { path: string; title: string; snippets: SearchSnippet[] }[] = [];
    for (const note of this.notes.values()) {
      let idx = note.lower.indexOf(lowerNeedle);
      const snippets: SearchSnippet[] = [];
      while (idx !== -1 && snippets.length < MAX_SNIPPETS) {
        const closeAt = note.content.indexOf(']]', idx);
        const linkText = closeAt === -1 ? '' : note.content.slice(idx + 2, closeAt);
        const target = linkText.split('|')[0].trim();
        if (target.toLowerCase() === title.toLowerCase()) {
          const start = Math.max(0, idx - SNIPPET_RADIUS);
          const end = Math.min(note.content.length, (closeAt === -1 ? idx + needle.length : closeAt + 2) + SNIPPET_RADIUS);
          const matchEnd = closeAt === -1 ? idx + needle.length : closeAt + 2;
          snippets.push({
            before: (start > 0 ? '…' : '') + note.content.slice(start, idx).replace(/\s+/g, ' '),
            match: note.content.slice(idx, matchEnd),
            after: note.content.slice(matchEnd, end).replace(/\s+/g, ' ') + (end < note.content.length ? '…' : ''),
          });
        }
        idx = note.lower.indexOf(lowerNeedle, idx + 2);
      }
      if (snippets.length) out.push({ path: note.path, title: note.title, snippets });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }
}
