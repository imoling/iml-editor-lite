/**
 * 区分说话人：每句话算一个声纹（识别进程里用 3D-Speaker CAM++ 算好送过来），这里决定「这句是谁说的」。
 *
 * 做法是在线聚类 —— 和已经出现过的人比，够像就归给他，不够像就算新来的人。关键在分长短句：
 * 实测两句都 ≥1.5 秒时，同一个人的相似度 ≥0.85、不同人 ≤0.5，界线很清楚；但「好的」「嗯」这种半秒的短句，
 * 同一个人也只有 0.46，和别人混在一起。所以只有长句才有资格「立新人」和更新声纹，短句只能归给已有的人，
 * 谁都不像就不标（宁可不标，也不凭半个字造出一个不存在的人）。
 *
 * 阈值来自合成语音的实测和模型的常用取值，真人远场的效果还没验证过；判错了用户可以改名 / 合并。
 */

export interface Speaker {
  id: string;
  name: string;
  /** 归给他的各句（归一化之后的）声纹之和；比较时再归一化。累加而不是只留第一句：说得越多，认得越准 */
  sum: number[];
  count: number;
}

export const LONG_UTTERANCE_SEC = 1.5;
/** 长句和某个人的声纹相似度到这个数，算同一个人 */
export const SAME_SPEAKER = 0.6;
/** 短句的要求放低：它本来就算不准，只求在已有的人里挑个最像的 */
export const SHORT_MATCH = 0.4;
export const ME_ID = 'me';

export function normalize(v: ArrayLike<number>): number[] {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

export const cosine = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function bestMatch(speakers: Speaker[], embedding: number[]): { index: number; score: number } {
  let index = -1, score = -1;
  speakers.forEach((p, i) => {
    if (p.sum.length !== embedding.length) return;   // 换过声纹模型：维度对不上的旧声纹不比
    const v = cosine(embedding, normalize(p.sum));
    if (v > score) { score = v; index = i; }
  });
  return { index, score };
}

/** 新来的人叫「说话人 N」：N 接着已有的编号往下排（「我」不占编号） */
function nextSpeaker(speakers: Speaker[], embedding: number[]): Speaker {
  const used = speakers.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] || 0));
  const n = Math.max(0, ...used) + 1;
  return { id: `s${n}`, name: `说话人 ${n}`, sum: embedding, count: 1 };
}

/**
 * 给一句话找说话人。返回新的说话人列表（不改传入的）和这句话归给谁；null = 没法判断。
 * embedding 为空（没开这个功能、或这一句算声纹失败）也是 null
 */
export function assignSpeaker(speakers: Speaker[], rawEmbedding: ArrayLike<number> | null | undefined, durationSec: number): { speakers: Speaker[]; speakerId: string | null } {
  if (!rawEmbedding || rawEmbedding.length === 0) return { speakers, speakerId: null };
  const embedding = normalize(rawEmbedding);
  const { index, score } = bestMatch(speakers, embedding);

  if (durationSec < LONG_UTTERANCE_SEC) {
    return { speakers, speakerId: index >= 0 && score >= SHORT_MATCH ? speakers[index].id : null };
  }
  if (index >= 0 && score >= SAME_SPEAKER) {
    const p = speakers[index];
    const updated = { ...p, sum: p.sum.map((x, i) => x + embedding[i]), count: p.count + 1 };
    return { speakers: speakers.map((s, i) => (i === index ? updated : s)), speakerId: p.id };
  }
  const created = nextSpeaker(speakers, embedding);
  return { speakers: [...speakers, created], speakerId: created.id };
}

/**
 * 改名。改成和另一个人一样的名字 = 这两个其实是同一个人：合并声纹，返回 mergedInto，调用方把句子改挂过去。
 * （分多了比分少了好办：分多了改个名就合上了，分少了没法拆）
 */
export function renameSpeaker(speakers: Speaker[], id: string, rawName: string): { speakers: Speaker[]; mergedInto: string | null } {
  const name = rawName.trim();
  const target = speakers.find((s) => s.id === id);
  if (!target || !name || name === target.name) return { speakers, mergedInto: null };
  const twin = speakers.find((s) => s.id !== id && s.name === name);
  if (!twin) return { speakers: speakers.map((s) => (s.id === id ? { ...s, name } : s)), mergedInto: null };
  const merged: Speaker = { ...twin, sum: twin.sum.length === target.sum.length ? twin.sum.map((x, i) => x + target.sum[i]) : twin.sum, count: twin.count + target.count };
  return { speakers: speakers.filter((s) => s.id !== id).map((s) => (s.id === twin.id ? merged : s)), mergedInto: twin.id };
}

/** id → 名字，给转写文本和界面用 */
export const speakerNames = (speakers: Speaker[]): Record<string, string> => Object.fromEntries(speakers.map((s) => [s.id, s.name]));

// ── 「这是我」：记住自己的声纹，以后每场转写自动认出来 ──────────────────────────
const ME_KEY = 'iml.voiceprint.me';

export function loadMyVoiceprint(): number[] | null {
  try { const v = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number') ? v : null; } catch { return null; }
}
export function saveMyVoiceprint(speaker: Speaker) { try { localStorage.setItem(ME_KEY, JSON.stringify(normalize(speaker.sum).map((x) => +x.toFixed(5)))); } catch { /* 存不了就只管这一场 */ } }
export function forgetMyVoiceprint() { try { localStorage.removeItem(ME_KEY); } catch { /* 无所谓 */ } }

/** 一场转写开始时的说话人列表：记过自己的声纹就先把「我」放进去 */
export function initialSpeakers(): Speaker[] {
  const mine = loadMyVoiceprint();
  return mine ? [{ id: ME_ID, name: '我', sum: mine, count: 1 }] : [];
}
