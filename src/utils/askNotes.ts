import type { AskSource } from '../types/window';

/**
 * 「问你的笔记」的提示词拼装与答案后处理。
 *
 * 面向的主要是本机 4B 以下的小模型，所以规则写得短而具体：只根据片段回答、找不到就直说、结论后面标编号。
 * 编号是给用户核对用的 —— 小模型会说错，带着来源，用户一眼能看出它说的对不对。
 */

export interface AskExchange { question: string; answer: string }

const SYSTEM_PROMPT = [
  '你是用户的笔记助手，只根据下面给出的「笔记片段」回答问题。',
  '规则：',
  '1. 片段里找不到答案时，直接回答「笔记里没有找到相关内容」，不要编造，也不要用常识补充。',
  '2. 用中文回答，简洁直接，先给结论。',
  '3. 每个结论后面用方括号标出它出自哪个片段，例如 [1] 或 [2][3]。',
].join('\n');

const MAX_SOURCE_CHARS = 800;
const MAX_HISTORY = 3;
const MAX_HISTORY_ANSWER = 300;

/** 去掉推理模型的思考过程；流式输出中途 <think> 还没闭合时，把它后面的全部先藏起来 */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trimStart();
}

/** 历史回答里的 [1] 指的是上一轮的片段，留着会和这一轮的编号混淆 */
export const stripCitations = (text: string) => text.replace(/\s*(?:\[\d+(?:\s*[,，、]\s*\d+)*\]|【\d+】)/g, '');

// 以指代词 / 承接词开头，或句中指着「上面说的」—— 这才是追问。换了话题的新问题不能带上旧问题，否则会把无关内容拉进来
const FOLLOW_UP_RE = /^(那|那么|它|他|她|这|其中|还有|然后|另外|再|具体|为什么呢|怎么会)|它们?|这个|那个|上面|刚才|前面|上述|第[一二三四五六七八九十\d]+[个条点项]/;

/**
 * 检索用的查询：追问往往省略主语（「那第二个呢」），单独拿去检索什么也找不到，带上上一个问题一起查。
 * 只对看起来像追问的才这么做。
 */
export function retrievalQuery(question: string, history: AskExchange[]): string {
  const last = history[history.length - 1];
  return last && FOLLOW_UP_RE.test(question.trim()) ? `${last.question} ${question}` : question;
}

/**
 * 模型是不是在说「笔记里没有」：这时候它列的引用和找到的「依据」都不该再摆出来。
 * 只看开头 30 个字 —— 拒答总是开门见山的；正常回答写到后面顺口一句「菜谱里没有提到火候」不能算。
 */
export function isRefusal(answer: string): boolean {
  return /没有找到|未找到|找不到|没有相关|没有提到|没有提及|没有记录|未提及|无法从/.test(answer.slice(0, 30));
}

export function buildAskMessages(question: string, sources: AskSource[], history: AskExchange[] = []): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const context = sources
    .map((s, i) => `[${i + 1}] ${s.heading}\n${s.text.length > MAX_SOURCE_CHARS ? `${s.text.slice(0, MAX_SOURCE_CHARS)}…` : s.text}`)
    .join('\n\n');
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const h of history.slice(-MAX_HISTORY)) {
    if (!h.answer.trim()) continue;
    messages.push({ role: 'user', content: h.question });
    messages.push({ role: 'assistant', content: stripCitations(stripThinking(h.answer)).slice(0, MAX_HISTORY_ANSWER) });
  }
  // 片段紧挨着问题放在最后一条里：小模型对离问题近的内容利用得最好
  messages.push({ role: 'user', content: `笔记片段：\n\n${context}\n\n问题：${question}` });
  return messages;
}

/**
 * 把答案里的 [1]、[2][3]、[1, 2]、【1】变成可点击的引用按钮（只认 1..sourceCount 范围内的编号）。
 * 直接改 DOM 的文本节点：代码块和链接里的方括号不动。
 */
export function linkCitations(container: HTMLElement, sourceCount: number): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('code, pre, a, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\[\d|【\d/.test(n.nodeValue || '')) targets.push(n as Text);

  const pattern = /\[(\d+(?:\s*[,，、]\s*\d+)*)\]|【(\d+)】/g;
  for (const node of targets) {
    const text = node.nodeValue || '';
    const frag = document.createDocumentFragment();
    let at = 0;
    let changed = false;
    for (const m of text.matchAll(pattern)) {
      const nums = (m[1] ?? m[2]).split(/\s*[,，、]\s*/).map(Number);
      if (!nums.every((x) => x >= 1 && x <= sourceCount)) continue;   // 「[2026]」这种不是引用
      frag.append(text.slice(at, m.index));
      for (const num of nums) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ask-cite';
        btn.dataset.cite = String(num);
        btn.textContent = String(num);
        frag.append(btn);
      }
      at = m.index! + m[0].length;
      changed = true;
    }
    if (!changed) continue;
    frag.append(text.slice(at));
    node.replaceWith(frag);
  }
}

/** 答案里实际引用到了哪些片段（去重、按出现顺序），用来把没被引用的来源淡化显示 */
export function citedNumbers(answer: string, sourceCount: number): number[] {
  const out: number[] = [];
  for (const m of answer.matchAll(/\[(\d+(?:\s*[,，、]\s*\d+)*)\]|【(\d+)】/g)) {
    for (const num of (m[1] ?? m[2]).split(/\s*[,，、]\s*/).map(Number)) {
      if (num >= 1 && num <= sourceCount && !out.includes(num)) out.push(num);
    }
  }
  return out;
}

/**
 * 点来源后用来在文档里定位的一小段字：取片段里第一段够长、不含标点的连续文字。
 * 片段是去掉 Markdown 标记后的纯文本，带标点或太长的串在原文里常常对不上，短而干净的才稳。
 */
export function locateFragment(text: string): string {
  const runs = text.split(/[\s，。、；：！？,.;:!?()（）「」『』《》"'“”‘’\-—|/\\[\]【】*_`~#>]+/).filter((s) => s.length >= 4);
  return (runs[0] || '').slice(0, 12);
}
