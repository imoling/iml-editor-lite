/**
 * 笔记元数据的纯函数：主进程（索引）与渲染进程（编辑器 / 预览）共用，不依赖 Node 或 DOM。
 * 放在 electron/ 下是因为主进程的 tsconfig 以 electron/ 为根，不能反过来引用 src/。
 */

// ── Frontmatter ───────────────────────────────────────────────────────────────

export interface FrontmatterSplit {
  /** 连同两条分隔线在内的原文（不含末尾换行）；没有 frontmatter 时为 null */
  block: string | null;
  /** 分隔线之间的 YAML 原文 */
  yaml: string;
  body: string;
  /** frontmatter 连同其后的空行一共占了多少行：正文行号据此偏移 */
  lineOffset: number;
}

const FM_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
/** 第一条有内容的行要像 `key:`，避免把「开头一条分割线」的普通文档误判成 frontmatter */
const FM_KEY_LINE = /^[^\s#:][^:]*:(\s|$)/;

export function splitFrontmatter(markdown: string): FrontmatterSplit {
  const none: FrontmatterSplit = { block: null, yaml: '', body: markdown || '', lineOffset: 0 };
  if (!markdown || !markdown.startsWith('---')) return none;
  const m = FM_RE.exec(markdown);
  if (!m) return none;
  const yaml = m[1] ?? '';
  const firstLine = yaml.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#'));
  if (firstLine !== undefined && !FM_KEY_LINE.test(firstLine)) return none;
  const rest = markdown.slice(m[0].length);
  const body = rest.replace(/^(?:[ \t]*\r?\n)+/, '');
  const consumed = markdown.slice(0, markdown.length - body.length);
  return {
    block: m[0].replace(/\r?\n$/, ''),
    yaml,
    body,
    lineOffset: consumed.split('\n').length - 1,
  };
}

/** 把 YAML 原文包回成完整的 frontmatter 块 */
export function buildFrontmatterBlock(yaml: string): string {
  const inner = yaml.replace(/\s+$/, '');
  return inner ? `---\n${inner}\n---` : '---\n---';
}

/** frontmatter 块（含分隔线）→ 中间的 YAML：直接去掉首尾两行，不再过一遍「像不像 YAML」的判断 */
export function frontmatterYaml(block: string): string {
  const lines = (block || '').split(/\r?\n/);
  return lines.length >= 2 ? lines.slice(1, -1).join('\n') : '';
}

export interface FrontmatterField {
  key: string;
  value: string | string[];
}

const unquote = (s: string) => {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  return t;
};

const splitInlineList = (s: string) => s.split(',').map(unquote).filter(Boolean);

/**
 * 只为「展示」服务的轻量 YAML 解析：标量、行内列表 [a, b]、块列表（- item）。
 * 嵌套对象、多行字符串原样当字符串显示。保存时用的永远是原文，解析不准也不会改坏文件。
 */
export function parseFrontmatter(yaml: string): FrontmatterField[] {
  const fields: FrontmatterField[] = [];
  let current: FrontmatterField | null = null;
  for (const raw of (yaml || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw) || /^-\s+(.*)$/.exec(raw);
    if (item && current) {
      if (!Array.isArray(current.value)) current.value = current.value ? [current.value] : [];
      current.value.push(unquote(item[1]));
      continue;
    }
    const kv = /^([^\s#:][^:]*):\s*(.*)$/.exec(raw);
    if (kv && !/^\s/.test(raw)) {
      const value = kv[2].trim();
      const inline = /^\[(.*)\]$/.exec(value);
      current = { key: kv[1].trim(), value: inline ? splitInlineList(inline[1]) : unquote(value) };
      fields.push(current);
      continue;
    }
    // 缩进的续行（嵌套对象 / 多行字符串）：拼到上一项后面
    if (current && !Array.isArray(current.value)) current.value = `${current.value}${current.value ? '\n' : ''}${raw.trim()}`;
  }
  return fields;
}

// ── 标签 ─────────────────────────────────────────────────────────────────────

/** 标签正文：字母 / 数字 / 汉字 / 下划线开头，后面还可以有 - 和 /（层级标签 a/b） */
const TAG_BODY = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_\\-/]*';
/** # 前面必须是行首、空白或中文标点：URL 片段（/#a）、锚点链接（(#a)）、C# 这类写法都不算标签 */
const TAG_BOUNDARY = '\\s，。、；：！？（【「『“‘';
const TAG_RE_SOURCE = `(^|[${TAG_BOUNDARY}])#(${TAG_BODY})`;

function isValidTag(tag: string): boolean {
  if (!tag) return false;
  if (/^\d+$/.test(tag)) return false; // #123 是编号
  if (/^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(tag)) return false; // #6366F1 是颜色
  if (/^[0-9a-fA-F]{3}$/.test(tag) && /\d/.test(tag)) return false; // #f0f 之类
  return true;
}

export interface TagRange {
  /** `#` 所在的下标 */
  from: number;
  to: number;
  tag: string;
}

/** 在一段纯文本里找出所有标签及其位置（编辑器高亮、预览渲染、索引都用这一个实现） */
export function findTags(text: string): TagRange[] {
  const out: TagRange[] = [];
  if (!text || !text.includes('#')) return out;
  const re = new RegExp(TAG_RE_SOURCE, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tag = m[2].replace(/[-/]+$/, '');
    const from = m.index + m[1].length;
    if (isValidTag(tag)) out.push({ from, to: from + 1 + tag.length, tag });
    // 边界字符可能同时是下一个标签的前导（"#a #b"），回退一格
    re.lastIndex = Math.max(from + 1 + tag.length, m.index + 1);
  }
  return out;
}

/** 紧跟在某段文本后面的 `#xxx` 是不是标签：prev 是 # 前一个字符（没有则传空串） */
export function matchTagAt(src: string, prev: string): string | null {
  if (!src.startsWith('#')) return null;
  if (prev && !new RegExp(`[${TAG_BOUNDARY}]`, 'u').test(prev)) return null;
  const m = new RegExp(`^#(${TAG_BODY})`, 'u').exec(src);
  if (!m) return null;
  const tag = m[1].replace(/[-/]+$/, '');
  return isValidTag(tag) ? tag : null;
}

/** 去掉不该找标签的区域：围栏代码、行内代码、HTML 注释、链接地址 */
export function stripNonProse(markdown: string): string {
  return (markdown || '')
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?=\n|$)|$)/gm, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)\n]*\)/g, '] ')
    .replace(/\[\[[^\]\n]*\]\]/g, ' ');
}

/** frontmatter 里的 tags / tag 字段（列表、逗号分隔或空格分隔的字符串都认） */
export function frontmatterTags(yaml: string): string[] {
  const out: string[] = [];
  for (const field of parseFrontmatter(yaml)) {
    if (!/^tags?$/i.test(field.key)) continue;
    const values = Array.isArray(field.value) ? field.value : field.value.split(/[,\s]+/);
    for (const v of values) {
      const tag = v.trim().replace(/^#/, '').replace(/[-/]+$/, '');
      if (tag && !/\s/.test(tag)) out.push(tag);
    }
  }
  return out;
}

/** 一篇笔记的全部标签（frontmatter + 正文），按出现顺序去重，大小写不敏感 */
export function extractTags(markdown: string): string[] {
  const { yaml, body } = splitFrontmatter(markdown || '');
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (tag: string) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };
  frontmatterTags(yaml).forEach(add);
  for (const line of stripNonProse(body).split('\n')) findTags(line).forEach((t) => add(t.tag));
  return out;
}

/** 选中 a 时，a 和 a/b 都算命中 */
export function tagMatches(noteTag: string, selected: string): boolean {
  const a = noteTag.toLowerCase();
  const b = selected.toLowerCase();
  return a === b || a.startsWith(`${b}/`);
}

// ── 提示块（Callout）─────────────────────────────────────────────────────────

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

/** GitHub 的五种 + Obsidian 常见别名，归并到五种配色；不认识的类型按 note 显示，但原文里的类型名照旧保留 */
const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  note: 'note', info: 'note', abstract: 'note', summary: 'note', tldr: 'note', quote: 'note', cite: 'note', example: 'note', todo: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
  important: 'important', question: 'important', help: 'important', faq: 'important',
  warning: 'warning', attention: 'warning',
  caution: 'caution', danger: 'caution', error: 'caution', failure: 'caution', fail: 'caution', missing: 'caution', bug: 'caution',
};

export function calloutKind(type: string): CalloutKind {
  return CALLOUT_ALIASES[(type || '').toLowerCase()] ?? 'note';
}

export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  note: '提示',
  tip: '技巧',
  important: '重要',
  warning: '警告',
  caution: '注意',
};

/** 标题栏显示的文字：有自定义标题用标题；五种标准类型用中文名；其余（Obsidian 的 bug / example 等）直接显示类型名 */
export function calloutLabel(type: string, title?: string | null): string {
  if (title && title.trim()) return title.trim();
  const lower = (type || '').toLowerCase();
  if (lower in CALLOUT_LABELS) return CALLOUT_LABELS[lower as CalloutKind];
  return type || CALLOUT_LABELS.note;
}

/** `[!NOTE]- 标题` 这样的首行 */
export const CALLOUT_HEAD_RE = /^\s*\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;
