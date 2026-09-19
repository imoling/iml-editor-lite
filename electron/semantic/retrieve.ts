/**
 * 「问你的笔记」的检索重排。
 *
 * 向量相似度擅长「意思相近」，但小嵌入模型对人名、日期、数字、术语这类**精确信息**不敏感 ——
 * 而这恰恰是问笔记时最常问的（「老王说的排期是哪天」）。所以在向量召回的候选里，
 * 再按「问题里的字词在分块里出现了多少」加一点分。不需要分词：中文取二元组，英文和数字取整词。
 */

export interface ChunkCandidate {
  path: string;
  title: string;
  /** 分块在这篇笔记里的序号 */
  index: number;
  /** 向量余弦相似度 */
  score: number;
  /** 分块全文（含「标题 › 小节」前缀） */
  text: string;
}

export interface RankedChunk extends ChunkCandidate {
  /** 问题里的字词有多大比例出现在这个分块里（0~1） */
  lexical: number;
  /** 最终排序用的分数 */
  final: number;
}

// 疑问词和虚词：出现在几乎所有问题里，对「找哪一块」没有区分度。替换成分隔符，二元组也不会跨过它们
const STOP = ['有没有', '为什么', '是不是', '什么', '怎么', '怎样', '如何', '哪个', '哪些', '哪天', '哪里', '哪儿', '多少', '是否', '请问', '一下', '关于', '时候',
  '的', '了', '吗', '呢', '吧', '啊', '是', '在', '有', '和', '与', '及', '或', '我', '你', '他', '她', '它', '们', '这', '那', '个', '说', '过', '要', '会', '能', '把', '被', '对', '里'];
const STOP_RE = new RegExp(STOP.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

/** 从问题里取用于字面匹配的词：中文二元组（单个字的词保留单字）+ 英文 / 数字整词，去重 */
export function lexicalTerms(question: string): string[] {
  const terms = new Set<string>();
  const text = question.toLowerCase().replace(STOP_RE, ' ');
  for (const word of text.match(/[a-z0-9][a-z0-9._-]*[a-z0-9]|[a-z0-9]/g) || []) if (word.length >= 2 || /\d/.test(word)) terms.add(word);
  for (const run of text.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) { terms.add(run); continue; }
    for (let i = 0; i + 2 <= run.length; i++) terms.add(run.slice(i, i + 2));
  }
  return [...terms];
}

export function lexicalScore(terms: string[], text: string): number {
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  let hit = 0;
  for (const t of terms) if (hay.includes(t)) hit++;
  return hit / terms.length;
}

export interface RerankOptions {
  /** 最多返回几块 */
  limit?: number;
  /** 同一篇笔记最多取几块：来源要多样，别让一篇长笔记占满上下文 */
  perNote?: number;
  /** 字面重合度的权重 */
  lexicalWeight?: number;
  /** 比第一名低这么多的就不要了：小模型的分数普遍偏高，低一大截的基本是噪声 */
  window?: number;
}

export function rerankChunks(candidates: ChunkCandidate[], question: string, opts: RerankOptions = {}): RankedChunk[] {
  const { limit = 8, perNote = 3, lexicalWeight = 0.2, window = 0.18 } = opts;
  const terms = lexicalTerms(question);
  const ranked = candidates
    .map((c) => { const lexical = lexicalScore(terms, c.text); return { ...c, lexical, final: c.score + lexicalWeight * lexical }; })
    .sort((a, b) => b.final - a.final);
  if (ranked.length === 0) return [];
  const floor = ranked[0].final - window;
  const taken = new Map<string, number>();
  const out: RankedChunk[] = [];
  for (const c of ranked) {
    if (c.final < floor || out.length >= limit) break;
    const n = taken.get(c.path) || 0;
    if (n >= perNote) continue;
    taken.set(c.path, n + 1);
    out.push(c);
  }
  return out;
}
