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

/** frontmatter 里的 aliases / alias 字段：这篇笔记的别名，`[[别名]]` 也能链到它（列表或逗号分隔的字符串都认） */
export function frontmatterAliases(yaml: string): string[] {
  const out: string[] = [];
  for (const field of parseFrontmatter(yaml)) {
    if (!/^alias(es)?$/i.test(field.key)) continue;
    const values = Array.isArray(field.value) ? field.value : field.value.split(',');
    for (const v of values) {
      const alias = v.trim();
      if (alias && !out.some((x) => x.toLowerCase() === alias.toLowerCase())) out.push(alias);
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

// ── 标签改名 / 合并 ──────────────────────────────────────────────────────────

/** 能不能当标签名：不带 #，不能有空格，不能是纯数字 / 颜色值（和识别标签用的是同一套规则） */
export function isValidTagName(name: string): boolean {
  const n = (name || '').trim();
  return !!n && matchTagAt(`#${n}`, '') === n;
}

/** 改名后的标签：from 本身 → to，子标签 from/x → to/x（子级那一段保留原样） */
const renamed = (tag: string, from: string, to: string) => to + tag.slice(from.length);

const blankSame = (s: string) => s.replace(/[^\n]/g, ' ');
/** 一行里不该找标签的地方抹成等长空格：行内代码、链接地址、双链、HTML 注释。下标和原行一致，才能就地替换 */
const maskLine = (line: string) => line
  .replace(/`[^`]*`/g, blankSame)
  .replace(/<!--.*?-->/g, blankSame)
  .replace(/\]\([^)]*\)/g, blankSame)
  .replace(/\[\[[^\]]*\]\]/g, blankSame);

function renameInYamlItem(item: string, from: string, to: string): string {
  const m = /^(\s*)(["']?)(#?)(.*?)\2(\s*)$/.exec(item);
  if (!m || !tagMatches(m[4], from)) return item;
  return `${m[1]}${m[2]}${m[3]}${renamed(m[4], from, to)}${m[2]}${m[5]}`;
}

const yamlTagKey = (item: string) => item.trim().replace(/^["']|["']$/g, '').replace(/^#/, '').toLowerCase();

/**
 * 一组标签项改名，并去掉合并后重复的。没有任何一项真的改了就返回 null——
 * 调用方据此整行原样保留，不因为「拆开又拼回去」给用户的文件带来无谓的改动。
 */
function renameItems(items: string[], from: string, to: string): string[] | null {
  let changed = false;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const next = renameInYamlItem(item, from, to);
    if (next !== item) changed = true;
    const k = yamlTagKey(next);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(next);
  }
  return changed ? out : null;
}

/** frontmatter 里的 tags / tag：行内列表 [a, b]、块列表（- a）、逗号或空格分隔的字符串都改；合并后重复的去掉 */
function renameInFrontmatter(lines: string[], from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const key = /^(tags?\s*:)(.*)$/i.exec(lines[i]);
    if (!key) { out.push(lines[i]); continue; }
    const value = key[2];

    const inline = /^(\s*)\[(.*)\](\s*)$/.exec(value);
    if (inline) {
      const items = renameItems(inline[2].split(','), from, to);
      out.push(items ? `${key[1]}${inline[1]}[${items.join(',')}]${inline[3]}` : lines[i]);
      continue;
    }

    if (value.trim()) {
      // 字符串写法 `tags: a, b c`：偶数位是标签、奇数位是它们之间的分隔符，分隔符原样留着
      const lead = /^\s*/.exec(value)![0];
      const tokens = value.trim().split(/([,\s]+)/);
      const tags = tokens.filter((_, idx) => idx % 2 === 0);
      const items = renameItems(tags, from, to);
      if (!items) { out.push(lines[i]); continue; }
      // 去重之后项数可能少了：分隔符统一用原来的第一个
      const sep = tokens[1] ?? ', ';
      out.push(key[1] + lead + (items.length === tags.length ? tokens.map((t, idx) => (idx % 2 === 0 ? items[idx / 2] : t)).join('') : items.join(sep)));
      continue;
    }

    // 块列表：后面连着的 `- item` 行
    out.push(lines[i]);
    const block: { prefix: string; item: string; line: string }[] = [];
    while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      i++;
      const m = /^(\s*-\s+)(.*)$/.exec(lines[i])!;
      block.push({ prefix: m[1], item: m[2], line: lines[i] });
    }
    const items = renameItems(block.map((x) => x.item), from, to);
    if (!items) { out.push(...block.map((x) => x.line)); continue; }
    // 保留每一项原来的缩进写法；去重丢掉的是后出现的那几项
    const seen = new Set<string>();
    for (const entry of block) {
      const next = renameInYamlItem(entry.item, from, to);
      const k = yamlTagKey(next);
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      out.push(entry.prefix + next);
    }
  }
  return out;
}

/**
 * 把一篇笔记里的标签 from 改成 to：正文的 `#from`、`#from/子级`，和 frontmatter 的 tags。
 * 围栏代码、行内代码、链接地址、双链里的不动。没有要改的地方时返回原字符串（同一个引用）。
 */
export function renameTagInMarkdown(markdown: string, from: string, to: string): string {
  const source = markdown || '';
  const a = from.trim().replace(/^#/, '');
  const b = to.trim().replace(/^#/, '');
  if (!a || !b || a === b) return source;
  const fm = splitFrontmatter(source);
  const lines = source.split('\n');
  const fmLines = fm.block === null ? 0 : fm.block.split('\n').length;

  const head = fmLines ? [lines[0], ...renameInFrontmatter(lines.slice(1, fmLines - 1), a, b), lines[fmLines - 1]] : [];
  let fence: string | null = null;
  const body = lines.slice(fmLines).map((line) => {
    const f = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return line;
    }
    if (fence || !line.includes('#')) return line;
    let next = line;
    // 从右往左换，前面的下标不受影响
    for (const hit of findTags(maskLine(line)).reverse()) {
      if (tagMatches(hit.tag, a)) next = `${next.slice(0, hit.from + 1)}${renamed(hit.tag, a, b)}${next.slice(hit.to)}`;
    }
    return next;
  });
  const result = [...head, ...body].join('\n');
  return result === source ? source : result;
}
