import { describe, it, expect } from 'vitest';
import { buildAskMessages, retrievalQuery, linkCitations, citedNumbers, locateFragment, stripThinking, isRefusal } from './askNotes';

const src = (n: number, text = `第 ${n} 块的正文`) => ({ path: `/lib/${n}.md`, title: `笔记${n}`, heading: `笔记${n} › 小节`, text, score: 0.7 });

describe('buildAskMessages', () => {
  it('片段带编号紧挨着问题，放在最后一条用户消息里', () => {
    const msgs = buildAskMessages('排期是哪天', [src(1), src(2)]);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('不要编造');
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('[1] 笔记1 › 小节\n第 1 块的正文');
    expect(last.content).toContain('[2] 笔记2 › 小节');
    expect(last.content.trim().endsWith('问题：排期是哪天')).toBe(true);
  });

  it('历史只带最近几轮的问与答：去掉旧编号和思考过程，空回答的轮次跳过', () => {
    const history = [
      { question: 'q0', answer: 'a0' }, { question: 'q1', answer: 'a1' },
      { question: 'q2', answer: '' },
      { question: 'q3', answer: '<think>想一想</think>定在周三 [1][2]。' },
    ];
    const msgs = buildAskMessages('那负责人呢', [src(1)], history);
    const text = msgs.map((m) => m.content).join('\n');
    expect(text).not.toContain('q0');            // 超出最近 3 轮
    expect(text).not.toContain('q2');            // 空回答
    expect(text).toContain('定在周三。');
    expect(text).not.toContain('想一想');
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(2);
  });

  it('过长的片段会被截断，免得一块占满上下文', () => {
    const msgs = buildAskMessages('q', [src(1, '字'.repeat(2000))]);
    expect(msgs[msgs.length - 1].content.length).toBeLessThan(1000);
  });
});

describe('retrievalQuery', () => {
  const history = [{ question: '26.3 的排期是哪天', answer: '…' }];

  it('追问带上上一个问题一起检索；第一问原样', () => {
    expect(retrievalQuery('排期是哪天', [])).toBe('排期是哪天');
    expect(retrievalQuery('那负责人呢', history)).toBe('26.3 的排期是哪天 那负责人呢');
    expect(retrievalQuery('它具体指什么', history)).toBe('26.3 的排期是哪天 它具体指什么');
    expect(retrievalQuery('展开说说第二点', history)).toBe('26.3 的排期是哪天 展开说说第二点');
  });

  it('换了话题的新问题不带旧问题 —— 否则会把无关内容拉进检索结果', () => {
    expect(retrievalQuery('番茄炒蛋怎么做', history)).toBe('番茄炒蛋怎么做');
    expect(retrievalQuery('向量数据库选了哪个', history)).toBe('向量数据库选了哪个');
  });
});

describe('引用', () => {
  const render = (html: string, count: number) => { const el = document.createElement('div'); el.innerHTML = html; linkCitations(el, count); return el; };

  it('[1]、[2][3]、[1, 2]、【1】都变成按钮', () => {
    const el = render('<p>定在周三 [1]，老王负责 [2][3]，见 [1, 2] 和【3】。</p>', 3);
    expect([...el.querySelectorAll('button.ask-cite')].map((b) => (b as HTMLElement).dataset.cite)).toEqual(['1', '2', '3', '1', '2', '3']);
    expect(el.textContent).toContain('定在周三');
  });

  it('超出范围的编号、代码和链接里的方括号不动', () => {
    const el = render('<p>到 [2026] 年 [9]</p><pre><code>arr[1]</code></pre><p><a href="#">见 [1]</a> 正文 [1]</p>', 2);
    expect(el.querySelectorAll('button.ask-cite')).toHaveLength(1);
    expect(el.querySelector('code')!.textContent).toBe('arr[1]');
    expect(el.textContent).toContain('[2026]');
  });

  it('citedNumbers 去重并保持出现顺序', () => {
    expect(citedNumbers('结论 [2]，另外 [1][2]，还有【3】和 [9]', 3)).toEqual([2, 1, 3]);
    expect(citedNumbers('没有引用', 3)).toEqual([]);
  });
});

describe('isRefusal', () => {
  it('认得出模型在说「笔记里没有」；正常回答里顺口一句「没有」不算', () => {
    expect(isRefusal('笔记里没有找到关于量子计算机工作原理的相关内容 [1][2]。')).toBe(true);
    expect(isRefusal('根据片段，未提及具体日期。')).toBe(true);
    expect(isRefusal('下次会议是 9 月 22 日 [1]。')).toBe(false);
    expect(isRefusal('番茄炒蛋的做法如下：鸡蛋先炒到七分熟……最后这一步没有固定标准，菜谱里也没有提到火候 [1]')).toBe(false);
  });
});

describe('stripThinking', () => {
  it('闭合的思考块去掉；流式中途没闭合的，后面全部先藏起来', () => {
    expect(stripThinking('<think>嗯</think>答案')).toBe('答案');
    expect(stripThinking('<think>还在想')).toBe('');
    expect(stripThinking('答案')).toBe('答案');
  });
});

describe('locateFragment', () => {
  it('取第一段够长、不含标点的连续文字', () => {
    expect(locateFragment('好的，那就这么定。下周三之前给出技术验证的结论。')).toBe('那就这么定');
    expect(locateFragment('用 sherpa 做内置引擎')).toBe('sherpa');
    expect(locateFragment('短。句。')).toBe('');
  });
});
