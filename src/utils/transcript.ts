/**
 * 实时转写的文字怎么变成笔记的一部分，以及怎么拿它生成纪要。
 *
 * 转写全文以一个**没有空行的** <details> HTML 块写进笔记：26.2 起 HTML 块按原文保留，
 * 富文本模式里它是一个折叠的整块（不会把几百行转写摊在正文里），GitHub / Obsidian / 导出的 HTML 里同样是折叠的；
 * 「问你的笔记」建索引时会去掉标签，转写内容照样搜得到、问得到。
 */

export interface TranscriptSegment {
  /** 这句话开始的时刻（秒，从开始转写算起） */
  start: number;
  text: string;
}

export const TRANSCRIPT_ATTR = 'data-iml-transcript';

const pad = (n: number) => String(n).padStart(2, '0');

/** 12:05，超过一小时写成 1:02:05 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** 给人看的时长：不到一分钟写秒，否则写分钟 */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${formatClock(s.start)}] ${s.text}`).join('\n');
}

const dateStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 整块里不能有空行：一有空行，Markdown 就会把它拆成「HTML 块 + 普通段落 + HTML 块」，折叠就失效了 */
export function buildTranscriptBlock(segments: TranscriptSegment[], startedAt: Date, durationSec: number): string {
  const lines = segments.filter((s) => s.text.trim()).map((s) => `<p>[${formatClock(s.start)}] ${escapeHtml(s.text.trim().replace(/\s*\n+\s*/g, ' '))}</p>`);
  return [
    `<details ${TRANSCRIPT_ATTR}>`,
    `<summary>转写全文 · ${formatDuration(durationSec)} · ${dateStamp(startedAt)}</summary>`,
    ...lines,
    '</details>',
  ].join('\n');
}

const BLOCK_RE = new RegExp(`<details ${TRANSCRIPT_ATTR}>[\\s\\S]*?</details>`, 'g');

/** 去掉笔记里的转写块，剩下的就是用户自己记的要点 */
export function stripTranscriptBlocks(content: string): string {
  return content.replace(BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function hasTranscriptBlock(content: string): boolean {
  return new RegExp(`<details ${TRANSCRIPT_ATTR}>`).test(content);
}

/** 追加到笔记末尾，前后各留一个空行 */
export function appendBlock(content: string, block: string): string {
  const body = content.replace(/\s+$/, '');
  return `${body}${body ? '\n\n' : ''}${block}\n`;
}

/**
 * 同一场转写再放一次（停了又继续录、或者手滑点了两下）：替换掉上次放进去的那一块，不重复追加。
 * 靠 <summary> 里的开始时间认「同一场」；找不到就追加到末尾
 */
export function upsertBlock(content: string, block: string, startedAt: Date): string {
  const stamp = dateStamp(startedAt);
  let replaced = false;
  const next = content.replace(BLOCK_RE, (old) => {
    if (replaced || !old.includes(`· ${stamp}</summary>`)) return old;
    replaced = true;
    return block;
  });
  return replaced ? next : appendBlock(content, block);
}

/** 纪要放在转写块前面（先看结论，再翻原文）；笔记里没有转写块就放末尾 */
export function insertMinutes(content: string, minutes: string): string {
  const section = `## 会议纪要\n\n${minutes.trim()}`;
  const at = content.search(new RegExp(`<details ${TRANSCRIPT_ATTR}>`));
  if (at < 0) return appendBlock(content, section);
  const before = content.slice(0, at).replace(/\s+$/, '');
  return `${before}${before ? '\n\n' : ''}${section}\n\n${content.slice(at)}`;
}

export function newMeetingNote(title: string, startedAt: Date, block: string): string {
  const d = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}`;
  return `---\ntype: meeting\ndate: ${d}\ntags: [会议]\n---\n\n# ${title}\n\n## 要点\n\n- \n\n${block}\n`;
}

export const meetingNoteTitle = (startedAt: Date) =>
  `会议记录 ${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())} ${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}`;

// ── 纪要 ─────────────────────────────────────────────────────────────────────

type Message = { role: 'system' | 'user'; content: string };

/** 一次喂给模型的转写上限：本机小模型上下文虽然够，但太长了又慢又容易漏；超过就分段提炼再合并 */
export const SUMMARY_PART_CHARS = 6000;

/** 按行切，不把一句话拦腰截断 */
export function splitForSummary(text: string, maxChars = SUMMARY_PART_CHARS): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > maxChars) { parts.push(current); current = ''; }
    current += (current ? '\n' : '') + line;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const MINUTES_FORMAT = [
  '按下面的结构输出 Markdown（没有内容的小节直接省略，不要写「无」）：',
  '### 议题与结论',
  '- 每个议题一条：讨论了什么，结论是什么',
  '### 待办',
  '- [ ] 事项（负责人，截止时间）—— 会上没说负责人或时间的，括号整个省掉，不要写「未明确」「待定」',
  '### 关键信息',
  '- 会上提到的数字、日期、名称等',
].join('\n');

const MINUTES_RULES = '只根据给出的材料写，不要补充材料里没有的内容；时间照原话写（比如「下周三」），不要自己推算成具体日期；转写是语音识别的结果，可能有错别字和同音字，按上下文理解；用中文，简洁；只输出纪要本身，末尾不要加说明或备注。';

/**
 * 模型交上来的纪要再收拾一遍：小模型爱在外面包一层 ```markdown、自己再起一个「会议纪要」标题（我们已经有了）、
 * 末尾加一条分隔线和「注：……」的自我说明 —— 这些都不该进用户的笔记
 */
export function cleanMinutes(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/^#{1,6}\s*会议纪要\s*\n+/, '');
  // 末尾的自我说明：只在它后面再没有标题和列表时才砍，免得误伤正文里恰好以「说明：」开头的一行
  const aside = /\n+(?:[-*_]{3,}\s*\n+)?[*_]*(?:注|备注|说明|Note)[*_]*\s*[:：]/gi;
  let cut = -1;
  for (let m = aside.exec(text); m; m = aside.exec(text)) cut = m.index;
  if (cut > 0 && !/\n\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s)/.test(text.slice(cut + 1).replace(/^[-*_]{3,}\s*\n+/, ''))) text = text.slice(0, cut);
  return text.replace(/\n+[-*_]{3,}\s*$/, '').trim();
}

/** 转写不长时一次成稿。用户自己记的要点是骨架 —— 他记下来的就是他认为重要的 */
export function buildMinutesMessages(userNotes: string, transcript: string): Message[] {
  const notes = userNotes.trim();
  return [
    { role: 'system', content: `你是会议纪要助手。${MINUTES_RULES}\n${MINUTES_FORMAT}` },
    { role: 'user', content: `${notes ? `我在会上自己记的要点（以它为骨架，它提到的内容要重点覆盖）：\n${notes}\n\n` : ''}会议转写全文：\n${transcript}\n\n请整理成会议纪要。` },
  ];
}

/** 长会议先逐段提炼 */
export function buildPartMessages(part: string, index: number, total: number): Message[] {
  return [
    { role: 'system', content: `你在帮忙整理一场长会议的转写，这是第 ${index + 1} 段（共 ${total} 段）。${MINUTES_RULES}` },
    { role: 'user', content: `转写片段：\n${part}\n\n把这一段里的议题、结论、待办（含负责人和时间）、关键数字逐条列出来，保留时间戳，不要总结成一句空话。` },
  ];
}

/** 再把各段的提炼合并成一份纪要 */
export function buildMergeMessages(userNotes: string, partSummaries: string[]): Message[] {
  const notes = userNotes.trim();
  return [
    { role: 'system', content: `你是会议纪要助手。${MINUTES_RULES}\n${MINUTES_FORMAT}` },
    { role: 'user', content: `${notes ? `我在会上自己记的要点（以它为骨架）：\n${notes}\n\n` : ''}下面是这场会议各段的提炼，按时间顺序：\n\n${partSummaries.map((s, i) => `【第 ${i + 1} 段】\n${s.trim()}`).join('\n\n')}\n\n请合并成一份会议纪要，重复的内容合并，前后矛盾的以后面的为准。` },
  ];
}
