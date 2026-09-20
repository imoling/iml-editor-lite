/**
 * 属性（frontmatter）的逐字段编辑。纯函数。
 *
 * 原则和属性块本身一致：用户的 YAML 原文不重新生成。改哪个字段就只改写那个字段占的那几行，
 * 别的字段、注释、空行、缩进、引号、字段顺序一个字符都不动。看不懂的写法（嵌套对象、多行字符串、锚点）
 * 标成 complex：界面上只读，留给「编辑原文」。
 */

export type PropKind = 'text' | 'number' | 'date' | 'checkbox' | 'list' | 'complex';

export interface PropField {
  key: string;
  kind: PropKind;
  /** list → string[]；checkbox → boolean；其余 → string（complex 是原文，仅供显示） */
  value: string | string[] | boolean;
  /** 这个字段在 YAML 行数组里占的范围 [from, to]，闭区间 */
  from: number;
  to: number;
}

const KEY_LINE = /^([^\s#:\-][^:]*?)\s*:(?:[ \t]+(.*))?[ \t]*$/;
const LIST_ITEM = /^([ \t]*)-[ \t]+(.*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const KEYWORD_RE = /^(true|false|null|yes|no|on|off|~)$/i;
/** 标签、别名写成一个字符串时（`tags: a, b`）也当列表看：这是 Obsidian 早期的通行写法 */
const LISTY_KEYS = /^(tags?|alias(es)?)$/i;

const stripEol = (l: string) => l.replace(/\r$/, '');

function unquote(raw: string): { text: string; quote: '"' | "'" | '' } {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return { text: t.slice(1, -1).replace(/\\(["\\])/g, '$1'), quote: '"' };
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return { text: t.slice(1, -1).replace(/''/g, "'"), quote: "'" };
  return { text: t, quote: '' };
}

/**
 * 值后面的 ` # 注释`：连同前面那段空白一起拆出来，改值的时候原样接回去（空格数也不变）。
 * 带引号的值、行内列表里可以有 #，要先找到它们的结尾，剩下的才算注释。
 */
function splitComment(value: string): { value: string; comment: string } {
  const lead = value.length - value.trimStart().length;
  const t = value.slice(lead);
  let end = 0;
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0];
    for (end = 1; end < t.length; end++) {
      if (q === '"' && t[end] === '\\') { end++; continue; }
      if (t[end] === q) { if (q === "'" && t[end + 1] === "'") { end++; continue; } end++; break; }
    }
  } else if (t.startsWith('[')) {
    let quote = '';
    for (end = 1; end < t.length; end++) {
      if (quote) { if (t[end] === quote) quote = ''; continue; }
      if (t[end] === '"' || t[end] === "'") quote = t[end];
      else if (t[end] === ']') { end++; break; }
    }
  }
  const rest = t.slice(end);
  const at = rest.search(/\s+#/);
  // 引号 / 方括号后面紧跟着的必须是注释，否则这不是我们认得的写法，整个当值
  if (at === -1 || (end > 0 && at !== 0)) return { value, comment: '' };
  return { value: value.slice(0, lead + end + at), comment: rest.slice(at) };
}

/** 行内列表 `[a, "b, c", d]` 按逗号拆开，引号里的逗号不算 */
function splitInline(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (const ch of inner) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out.map((x) => unquote(x).text).filter((x) => x !== '');
}

const looksComplex = (v: string) => /^[|>&*!{]/.test(v) || /^\[.*[{[]/.test(v.slice(1));

export function readProps(yaml: string): PropField[] {
  const lines = (yaml || '').split('\n').map(stripEol);
  const out: PropField[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = KEY_LINE.exec(lines[i]);
    if (!m) continue;
    const key = m[1].trim();
    // 这个字段往下占到哪：缩进的行、列表项；中间的空行只有后面还跟着缩进内容时才算它的
    let to = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) { if (/^[ \t]+\S/.test(lines[j + 1] ?? '')) continue; break; }
      if (/^[ \t]/.test(l) || LIST_ITEM.test(l)) { to = j; continue; }
      break;
    }
    // 标签 / 别名写成字符串时，`#想法` 是标签不是注释——和标签索引（frontmatterTags）的认法保持一致
    const listyScalar = LISTY_KEYS.test(key) && !!(m[2] ?? '').trim() && !/^[[|>]/.test((m[2] ?? '').trim());
    const { value: rawValue } = listyScalar ? { value: m[2] ?? '' } : splitComment(m[2] ?? '');
    const v = rawValue.trim();
    const rest = lines.slice(i + 1, to + 1).filter((l) => l.trim());
    let field: PropField;
    if (!v && rest.length && rest.every((l) => LIST_ITEM.test(l))) {
      const items = rest.map((l) => LIST_ITEM.exec(l)![2]);
      // 列表项本身是对象（`- name: x`）或带注释的，不拆
      field = items.some((x) => /^[^"'].*:\s/.test(x) || /^[{[&*!|>]/.test(x))
        ? { key, kind: 'complex', value: lines.slice(i, to + 1).join('\n'), from: i, to }
        : { key, kind: 'list', value: items.map((x) => unquote(splitComment(x).value).text).filter(Boolean), from: i, to };
    } else if (rest.length || looksComplex(v)) {
      field = { key, kind: 'complex', value: lines.slice(i, to + 1).join('\n'), from: i, to };
    } else if (/^\[.*\]$/.test(v)) {
      field = { key, kind: 'list', value: splitInline(v.slice(1, -1)), from: i, to };
    } else {
      const { text, quote } = unquote(v);
      if (!quote && /^(true|false)$/i.test(text)) field = { key, kind: 'checkbox', value: text.toLowerCase() === 'true', from: i, to };
      else if (DATE_RE.test(text)) field = { key, kind: 'date', value: text, from: i, to };
      else if (!quote && NUMBER_RE.test(text)) field = { key, kind: 'number', value: text, from: i, to };
      else if (LISTY_KEYS.test(key) && text) field = { key, kind: 'list', value: text.split(/^tags?$/i.test(key) ? /[,\s]+/ : /,/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean), from: i, to };
      else field = { key, kind: 'text', value: text, from: i, to };
    }
    out.push(field);
    i = to;
  }
  return out;
}

/** 写成 YAML 标量：能不加引号就不加；会被 YAML 误读成别的类型 / 结构的才加 */
function scalar(text: string, prefer: '"' | "'" | '' = '', inList = false): string {
  const risky = text === '' || /^\s|\s$/.test(text) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) || /:\s|\s#/.test(text)
    || KEYWORD_RE.test(text) || NUMBER_RE.test(text) || (inList && /[,\]]/.test(text));
  if (prefer === "'" && !text.includes("'")) return `'${text}'`;
  if (!risky && !prefer) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function findField(yaml: string, key: string): PropField | undefined {
  return readProps(yaml).find((f) => f.key.toLowerCase() === key.trim().toLowerCase());
}

const eolOf = (yaml: string) => (/\r\n/.test(yaml) ? '\r\n' : '\n');

/**
 * 设一个字段的值；没有这个字段就加在最后。值的类型决定写法：
 * boolean → true / false；string[] → 列表（原来是块列表就还写块列表，缩进照旧；否则写 [a, b]）；string → 标量。
 * 日期、数字按原样不加引号写出去（调用方保证格式）。complex 字段不让改，原样返回。
 */
export function setProp(yaml: string, key: string, value: string | string[] | boolean, as?: PropKind): string {
  const eol = eolOf(yaml);
  const lines = yaml ? yaml.split('\n').map(stripEol) : [];
  const field = findField(yaml, key);
  if (field?.kind === 'complex') return yaml;

  let next: string[];
  if (field) {
    const head = KEY_LINE.exec(lines[field.from])!;
    const { value: oldRaw, comment } = splitComment(head[2] ?? '');
    const keyPart = lines[field.from].slice(0, lines[field.from].indexOf(':') + 1);
    if (Array.isArray(value)) {
      const blockItems = lines.slice(field.from + 1, field.to + 1).filter((l) => LIST_ITEM.test(l));
      if (blockItems.length && value.length) {
        const indent = LIST_ITEM.exec(blockItems[0])![1];
        // 每一项原来用的引号按「值」记，不按下标：删掉前面的项之后下标就错位了
        const quoteOf = new Map(blockItems.map((l) => { const u = unquote(LIST_ITEM.exec(l)![2]); return [u.text, u.quote] as const; }));
        next = [lines[field.from], ...value.map((v) => `${indent}- ${scalar(v, quoteOf.get(v) ?? '')}`)];
      } else {
        next = [`${keyPart} [${value.map((v) => scalar(v, '', true)).join(', ')}]${comment}`];
      }
    } else if (typeof value === 'boolean') {
      next = [`${keyPart} ${value ? 'true' : 'false'}${comment}`];
    } else {
      const kind = as ?? field.kind;
      // 清空了就只留 `key:`，不写成 `key: ""`
      const raw = value.trim() === '' ? '' : kind === 'date' || kind === 'number' ? value.trim() : scalar(value, unquote(oldRaw).quote);
      next = [raw === '' ? `${keyPart}${comment}` : `${keyPart} ${raw}${comment}`];
    }
    lines.splice(field.from, field.to - field.from + 1, ...next);
  } else {
    const k = key.trim();
    const written = Array.isArray(value) ? `[${value.map((v) => scalar(v, '', true)).join(', ')}]`
      : typeof value === 'boolean' ? (value ? 'true' : 'false')
      : value.trim() === '' ? '' : as === 'date' || as === 'number' ? value.trim() : scalar(value);
    // 加在最后一个有内容的行后面，末尾原有的空行留在后头
    let at = lines.length;
    while (at > 0 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, written === '' ? `${k}:` : `${k}: ${written}`);
  }
  return lines.join(eol);
}

export function removeProp(yaml: string, key: string): string {
  const field = findField(yaml, key);
  if (!field) return yaml;
  const lines = (yaml || '').split('\n').map(stripEol);
  lines.splice(field.from, field.to - field.from + 1);
  return lines.join(eolOf(yaml));
}

/** 能不能当属性名：不能空、不能带冒号 / 井号 / 换行，不能以空格或 `-` 开头 */
export const isValidPropKey = (key: string) => /^[^\s#:\-][^:#\n]*$/.test(key) && key === key.trim();

/** 改属性名（值和后面的行不动）。新名字不合法、或已经有同名字段时返回 null */
export function renameProp(yaml: string, key: string, nextKey: string): string | null {
  const to = nextKey.trim();
  if (!isValidPropKey(to)) return null;
  const field = findField(yaml, key);
  if (!field) return null;
  if (to.toLowerCase() !== field.key.toLowerCase() && findField(yaml, to)) return null;
  const lines = (yaml || '').split('\n').map(stripEol);
  const line = lines[field.from];
  lines[field.from] = to + line.slice(line.indexOf(field.key) + field.key.length);
  return lines.join(eolOf(yaml));
}
