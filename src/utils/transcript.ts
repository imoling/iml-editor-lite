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
  /** 说话人的 id（开了「区分说话人」才有；null = 这一句太短，判断不了） */
  speaker?: string | null;
}

/** 说话人 id → 名字 */
export type SpeakerNames = Record<string, string>;
const who = (s: TranscriptSegment, names?: SpeakerNames) => (s.speaker && names?.[s.speaker] ? `${names[s.speaker]}：` : '');

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

export function transcriptText(segments: TranscriptSegment[], names?: SpeakerNames): string {
  return segments.map((s) => `[${formatClock(s.start)}] ${who(s, names)}${s.text}`).join('\n');
}

const dateStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 录音文件名：同一场转写始终是同一个名字（再存一次就是覆盖成更长的那份） */
export function recordingFileName(startedAt: Date): string {
  return `录音-${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}.webm`;
}

/** 「[01:15] 这句话」→ 75；不是时间戳开头的返回 null。笔记里点一句话跳到录音的对应位置要用 */
export function parseClock(line: string): number | null {
  const m = /^\s*\[(?:(\d+):)?(\d{1,2}):(\d{2})\]/.exec(line);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * 整块里不能有空行：一有空行，Markdown 就会把它拆成「HTML 块 + 普通段落 + HTML 块」，折叠就失效了。
 * audioSrc：录音相对笔记的地址（assets/录音-….webm）；有的话块里带一个播放器
 */
export function buildTranscriptBlock(segments: TranscriptSegment[], startedAt: Date, durationSec: number, audioSrc?: string | null, names?: SpeakerNames): string {
  const lines = segments.filter((s) => s.text.trim()).map((s) => `<p>[${formatClock(s.start)}] ${escapeHtml(`${who(s, names)}${s.text.trim().replace(/\s*\n+\s*/g, ' ')}`)}</p>`);
  return [
    `<details ${TRANSCRIPT_ATTR}>`,
    `<summary>转写全文 · ${formatDuration(durationSec)} · ${dateStamp(startedAt)}</summary>`,
    ...(audioSrc ? [`<audio controls preload="metadata" src="${escapeHtml(audioSrc).replace(/"/g, '&quot;')}"></audio>`] : []),
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

/**
 * 给本机小模型（4B 级）写的提示词，几条都是实测踩出来的：
 * - 格式模板里只放格式。把「没说负责人就别写」这类说明塞进模板行里，小模型会把说明也照抄成输出（「—— 未明确负责人」）
 * - 用两行待办示范「有括号 / 没括号」两种写法，比用文字解释管用
 * - 不设「关键信息」一节：小模型会把前面的内容原样再抄一遍，白白多花一倍时间
 */
const MINUTES_RULES = [
  '规则：',
  '1. 只写转写里说到的内容，不补充、不推断。转写是语音识别的结果，有错别字和同音字，按上下文理解。时间戳后面如果有「名字：」，那是说话人（自动区分的，偶尔会标错）。',
  '2. 时间照原话写（比如「下周三」），不要自己推算成具体日期。',
  '3. 待办只列会上明确要某人去做、或大家约定要做的事。说了负责人或时间的写在括号里；没说的只写事项本身，不要写「未明确」「待定」。',
  '4. 用中文，简洁。只输出纪要本身，末尾不要加说明、备注或总结。',
].join('\n');

const MINUTES_FORMAT = [
  '输出格式（Markdown；某一节没有内容就整节省略）：',
  '### 议题与结论',
  '- 议题：结论',
  '### 待办',
  '- [ ] 事项（负责人，时间）',
  '- [ ] 没说负责人和时间的事项',
].join('\n');

/** 用户自己记的要点怎么用：判断轻重、纠正识别错的专有名词；笔记里以前记的、和这场会无关的内容不能混进纪要 */
const NOTES_HINT = '我在会上自己记的要点（用它判断哪些内容重要，并纠正转写里识别错的专有名词；其中和这次转写对不上的内容是以前记的，不要写进纪要）';

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
  text = text.replace(/\n+[-*_]{3,}\s*$/, '').trim();
  return mergeSections(text.split('\n').map(dropUnknowns).join('\n'));
}

/** 「（负责人：未明确）」「—— 未明确负责人、截止时间」：小模型管不住嘴，会上没说的就该什么都不写 */
const UNKNOWN = '(?:未明确|未指定|未提及|未说明|未确定|不明确|待定|暂无|无)';
function dropUnknowns(line: string): string {
  return line
    .replace(new RegExp(`\\s*[（(][^（()）]*${UNKNOWN}[^（()）]*[）)]`, 'g'), '')
    .replace(new RegExp(`(?<=\\S)\\s*(?:——|--|—)\\s*[^，。；—]*${UNKNOWN}[^。；]*$`), '')
    .replace(/\s+$/, '');
}

/** 同名的小节合成一个（小模型偶尔把「待办」写两遍），小节里完全相同的条目只留一条 */
function mergeSections(text: string): string {
  type Section = { title: string; heading: string; lines: string[] };
  let current: Section = { title: '', heading: '', lines: [] };
  const sections: Section[] = [current];
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!heading) { current.lines.push(line); continue; }
    const existing = sections.find((s) => s.title === heading[1]);
    if (existing) { current = existing; continue; }
    current = { title: heading[1], heading: line.trim(), lines: [] };
    sections.push(current);
  }
  return sections
    .map((s) => {
      // 同一件事换个括号写法再说一遍也算重复：按括号前面的部分认
      const seen = new Set<string>();
      let lines = s.lines.filter((l) => { const key = l.replace(/\s*[（(].*$/, '').trim(); if (!key) return true; if (seen.has(key)) return false; seen.add(key); return true; });
      // 整节都是列表的话，条目之间不留空行（两段合并过来时中间会夹一个）
      const body = lines.filter((l) => l.trim());
      if (body.length > 0 && body.every((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l))) lines = body;
      return [s.heading, ...lines].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 用户的笔记交给模型之前收拾一下：属性区、已经勾掉的任务（做完的事不是这次的待办）、行内 #标签 都拿掉。
 * 小模型看到什么抄什么，这些东西留着只会被原样搬进纪要
 */
export function notesForMinutes(userNotes: string): string {
  return userNotes
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .split('\n')
    .filter((line) => !/^\s*[-*+]\s+\[[xX]\]\s/.test(line))
    .map((line) => line.replace(/(^|\s)#(?!\d+(?=\s|$))[^\s#]+(?=\s|$)/g, '$1').replace(/[ \t]+$/, ''))   // 纯数字的（issue #12）不是标签
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 转写不长时一次成稿。用户自己记的要点用来判断轻重 —— 他记下来的就是他认为重要的 */
export function buildMinutesMessages(userNotes: string, transcript: string): Message[] {
  const notes = notesForMinutes(userNotes);
  return [
    { role: 'system', content: `你是会议纪要助手，根据会议转写整理纪要。\n${MINUTES_RULES}\n${MINUTES_FORMAT}` },
    { role: 'user', content: `${notes ? `${NOTES_HINT}：\n${notes}\n\n` : ''}会议转写全文：\n${transcript}\n\n请整理成会议纪要。` },
  ];
}

/** 长会议先逐段提炼 */
export function buildPartMessages(part: string, index: number, total: number): Message[] {
  return [
    { role: 'system', content: `你在帮忙整理一场长会议的转写，这是第 ${index + 1} 段（共 ${total} 段）。\n${MINUTES_RULES}` },
    { role: 'user', content: `转写片段：\n${part}\n\n把这一段里的议题和结论、待办（含负责人和时间）、提到的数字逐条列出来，保留时间戳，不要总结成一句空话。` },
  ];
}

/** 再把各段的提炼合并成一份纪要 */
export function buildMergeMessages(userNotes: string, partSummaries: string[]): Message[] {
  const notes = notesForMinutes(userNotes);
  return [
    { role: 'system', content: `你是会议纪要助手，把一场长会议各段的提炼合并成一份纪要。\n${MINUTES_RULES}\n${MINUTES_FORMAT}` },
    { role: 'user', content: `${notes ? `${NOTES_HINT}：\n${notes}\n\n` : ''}下面是这场会议各段的提炼，按时间顺序：\n\n${partSummaries.map((s, i) => `【第 ${i + 1} 段】\n${s.trim()}`).join('\n\n')}\n\n请合并成一份会议纪要，重复的内容合并，前后矛盾的以后面的为准。` },
  ];
}
