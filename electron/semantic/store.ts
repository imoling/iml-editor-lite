import fs from 'fs';
import path from 'path';
import { centroid, decodeVector, dot, encodeVector } from './chunk';

export interface StoredChunk {
  preview: string;
  vec: Float32Array;
}

export interface StoredNote {
  path: string;
  title: string;
  /** 内容指纹（mtime + 长度），变了才重算 */
  stamp: string;
  chunks: StoredChunk[];
  centroid: Float32Array;
}

export interface SemanticHit {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

const FORMAT_VERSION = 1;

/** 一个笔记库 × 一个嵌入模型的向量库：常驻内存，防抖落盘成一个 JSON 文件 */
export class VectorStore {
  notes = new Map<string, StoredNote>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private file: string, private modelId: string, private dims: number) {}

  async load(): Promise<void> {
    this.notes.clear();
    try {
      const raw = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
      if (raw?.version !== FORMAT_VERSION || raw.modelId !== this.modelId || raw.dims !== this.dims) return;
      for (const n of raw.notes as any[]) {
        const chunks: StoredChunk[] = n.chunks.map((c: any) => ({ preview: c.p, vec: decodeVector(c.v) }));
        if (chunks.some((c) => c.vec.length !== this.dims)) continue;
        this.notes.set(n.path, { path: n.path, title: n.title, stamp: n.stamp, chunks, centroid: centroid(chunks.map((c) => c.vec)) });
      }
    } catch { /* 第一次建库，或文件损坏：从空库开始 */ }
  }

  scheduleSave(delay = 3000) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.save(); }, delay);
  }

  async save(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const payload = {
      version: FORMAT_VERSION,
      modelId: this.modelId,
      dims: this.dims,
      notes: [...this.notes.values()].map((n) => ({
        path: n.path, title: n.title, stamp: n.stamp,
        chunks: n.chunks.map((c) => ({ p: c.preview, v: encodeVector(c.vec) })),
      })),
    };
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf8');
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      console.warn('[semantic] save failed:', err);
    }
  }

  upsert(note: Omit<StoredNote, 'centroid'>) {
    this.notes.set(note.path, { ...note, centroid: centroid(note.chunks.map((c) => c.vec)) });
  }

  remove(filePath: string) {
    this.notes.delete(filePath);
  }

  /** 与某篇笔记最相近的其它笔记（按整篇的平均向量比较） */
  related(filePath: string, limit = 6, minScore = 0.6): SemanticHit[] {
    const self = this.notes.get(filePath);
    if (!self || self.centroid.length === 0) return [];
    const hits: SemanticHit[] = [];
    for (const other of this.notes.values()) {
      if (other.path === filePath || other.centroid.length === 0) continue;
      const score = dot(self.centroid, other.centroid);
      if (score < minScore) continue;
      // 片段取对方与本篇最接近的那一块
      let best = other.chunks[0];
      let bestScore = -1;
      for (const c of other.chunks) {
        const s = dot(self.centroid, c.vec);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      hits.push({ path: other.path, title: other.title, score, snippet: best?.preview ?? '' });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * 查询向量 vs 全部分块：每篇取最高分的那一块。
   * 除了绝对下限，还按最高分做相对截断 —— 小模型的分数普遍偏高，比第一名低一大截的基本是噪声。
   */
  search(query: Float32Array, limit = 20, minScore = 0.4, window = 0.12): SemanticHit[] {
    const hits: SemanticHit[] = [];
    for (const note of this.notes.values()) {
      let best: StoredChunk | null = null;
      let bestScore = -1;
      for (const c of note.chunks) {
        const s = dot(query, c.vec);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (best && bestScore >= minScore) hits.push({ path: note.path, title: note.title, score: bestScore, snippet: best.preview });
    }
    hits.sort((a, b) => b.score - a.score);
    const floor = hits.length ? hits[0].score - window : 0;
    return hits.filter((h) => h.score >= floor).slice(0, limit);
  }
}
