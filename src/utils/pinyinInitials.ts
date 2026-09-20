/**
 * 汉字 → 拼音首字母，给「快速打开」用（敲 xmzh 找到「项目周会」）。
 *
 * 不带拼音字典（完整的字典要上兆）：中文的拼音排序规则是运行环境自带的，
 * 拿每个声母区间的第一个字当界桩，看一个字按拼音排在哪两个界桩之间，就知道它的首字母。
 * 多音字只认最常用的那个读音——用来找笔记够了，读错一个字的代价只是这一次没搜到。
 */
const BOUNDARIES: [string, string][] = [
  ['a', '阿'], ['b', '八'], ['c', '嚓'], ['d', '哒'], ['e', '妸'], ['f', '发'], ['g', '旮'], ['h', '哈'],
  ['j', '讥'], ['k', '咔'], ['l', '垃'], ['m', '妈'], ['n', '拏'], ['o', '噢'], ['p', '妑'], ['q', '七'],
  ['r', '呥'], ['s', '仨'], ['t', '他'], ['w', '屲'], ['x', '夕'], ['y', '丫'], ['z', '帀'],
];
const CJK_RE = /[一-鿿]/;

let collator: Intl.Collator | null | undefined;
function getCollator(): Intl.Collator | null {
  if (collator !== undefined) return collator;
  try {
    const c = new Intl.Collator('zh-Hans-CN-u-co-pinyin');
    // 运行环境没带中文排序规则时会悄悄退回按码位比：拿两个字验一下，不对就整个功能关掉，别给出错的首字母
    collator = c.compare('阿', '帀') < 0 && c.compare('妈', '八') > 0 ? c : null;
  } catch {
    collator = null;
  }
  return collator;
}

const cache = new Map<string, string>();

/** 一个汉字的拼音首字母；不是汉字、或环境不支持时返回空串 */
export function initialOf(ch: string): string {
  if (!CJK_RE.test(ch)) return '';
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  const c = getCollator();
  let letter = '';
  if (c) {
    for (const [l, boundary] of BOUNDARIES) {
      if (c.compare(ch, boundary) >= 0) letter = l; else break;
    }
  }
  cache.set(ch, letter);
  return letter;
}

/**
 * 逐字符的首字母串，和原文一一对应（长度相同）：汉字 → 首字母，字母数字 → 小写的自己，其余 → 空格。
 * 一一对应是为了命中之后能把区间原样搬回标题上做高亮。
 */
export function initialsOf(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch.length > 1) { out += ' '.repeat(ch.length); continue; } // 代理对（emoji 等）占两个码元，补齐长度
    out += initialOf(ch) || (/[a-z0-9]/i.test(ch) ? ch.toLowerCase() : ' ');
  }
  return out;
}
