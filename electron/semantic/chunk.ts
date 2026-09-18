import { splitFrontmatter } from '../shared/noteMeta';

export interface NoteChunk {
  /** 送去做向量的文本：带上「笔记标题 › 小节标题」，短块也有足够的上下文 */
  text: string;
  /** 给界面看的片段（不含标题前缀） */
  preview: string;
}

const MAX_CHUNKS_PER_NOTE = 200;
const PREVIEW_CHARS = 90;

/** 去掉对语义没帮助、又占 token 的东西：图片 / 链接地址、HTML 标签、data URL、表格分隔行 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, l?: string) => l || t)
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, ' ')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
    // 行首的列表 / 任务 / 引用标记、提示块的 [!类型]、公式的 $ 定界符：对语义没贡献，出现在片段里也难看
    .replace(/^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, '')
    .replace(/\[![A-Za-z][\w-]*\][+-]?/g, '')
    .replace(/\${1,2}/g, ' ')
    .replace(/[*_`~>#|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 过长的段落按句末标点切开；还是太长就硬切 */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[。！？!?；;\n])/)) {
    if ((current + sentence).length > max && current) { out.push(current); current = ''; }
    if (sentence.length > max) {
      for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max));
    } else {
      current += sentence;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

/**
 * 把一篇笔记切成适合做向量的小块：按标题分节，节内按空行分段，小段合并、大段拆开。
 * maxChars 是整条文本（含标题前缀）的上限。
 */
export function chunkNote(title: string, markdown: string, maxChars: number): NoteChunk[] {
  const body = splitFrontmatter(markdown || '').body;
  const chunks: NoteChunk[] = [];
  let heading = '';
  let buffer = '';
  let fence: string | null = null;

  const flush = () => {
    const text = plainText(buffer);
    buffer = '';
    if (text.length < 8) return; // 太短的块（只有几个字）没有检索价值
    const prefix = [title, heading].filter(Boolean).join(' › ').slice(0, 60);
    const room = Math.max(80, maxChars - prefix.length - 1);
    for (const piece of splitLong(text, room)) {
      if (chunks.length >= MAX_CHUNKS_PER_NOTE) return;
      chunks.push({ text: prefix ? `${prefix}\n${piece}` : piece, preview: piece.replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS) });
    }
  };

  const prefixLen = () => Math.min(60, [title, heading].filter(Boolean).join(' › ').length);

  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) { buffer += `${line}\n`; continue; }
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      heading = plainText(h[1]);
      continue;
    }
    if (!line.trim()) {
      // 段落边界：攒够了就出块，没攒够继续并下一段
      if (buffer.length >= (maxChars - prefixLen()) * 0.6) flush();
      else if (buffer) buffer += '\n';
      continue;
    }
    if (buffer.length + line.length > maxChars - prefixLen()) flush();
    buffer += `${line}\n`;
  }
  flush();

  // 只有标题、没有正文的笔记也给一个块，至少能按标题被找到
  if (chunks.length === 0 && title.trim()) chunks.push({ text: title, preview: '' });
  return chunks;
}

// ── 向量运算 ─────────────────────────────────────────────────────────────────

export function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** 两个已归一化向量的点积即余弦相似度 */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

export function centroid(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const out = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return normalize(out);
}

export const encodeVector = (vec: Float32Array) => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64');
export const decodeVector = (b64: string) => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)).slice();
};
