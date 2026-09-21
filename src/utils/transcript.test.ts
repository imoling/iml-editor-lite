import { describe, it, expect } from 'vitest';
import { formatClock, formatDuration, buildTranscriptBlock, stripTranscriptBlocks, hasTranscriptBlock, appendBlock, upsertBlock, insertMinutes, newMeetingNote, splitForSummary, transcriptText, buildMinutesMessages, buildMergeMessages, cleanMinutes, recordingFileName, parseClock, notesForMinutes } from './transcript';
import { markdownToHtml, htmlToMarkdown } from './markdown';

const SEGS = [{ start: 0.2, text: '大家好，我们开始今天的周会。' }, { start: 3.6, text: '第一个议题是 26.3 的排期 <紧急> & 重要' }, { start: 3725, text: '散会。' }];
const AT = new Date(2026, 8, 20, 14, 5);

describe('时间格式', () => {
  it('时间戳：一小时以内 mm:ss，超过写 h:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(75.9)).toBe('01:15');
    expect(formatClock(3725)).toBe('1:02:05');
  });
  it('时长：给人看的粗略说法', () => {
    expect(formatDuration(42)).toBe('42 秒');
    expect(formatDuration(1500)).toBe('25 分钟');
    expect(formatDuration(3900)).toBe('1 小时 5 分钟');
  });
});

describe('转写块', () => {
  const block = buildTranscriptBlock(SEGS, AT, 3730);

  it('是一个没有空行的 <details>：一有空行 Markdown 就会把它拆开，折叠就失效', () => {
    expect(block.startsWith('<details data-iml-transcript>')).toBe(true);
    expect(block.endsWith('</details>')).toBe(true);
    expect(block).not.toMatch(/\n\s*\n/);
    expect(block).toContain('<summary>转写全文 · 1 小时 2 分钟 · 2026-09-20 14:05</summary>');
    expect(block).toContain('<p>[1:02:05] 散会。</p>');
  });

  it('转写里的尖括号和 & 要转义，不然会被当成标签吃掉', () => {
    expect(block).toContain('&lt;紧急&gt; &amp; 重要');
  });

  it('带录音的转写块：播放器在摘要下面，仍然没有空行，富文本往返不变；去掉转写块时一并去掉', () => {
    const src = `assets/${recordingFileName(AT)}`;
    expect(src).toBe('assets/录音-20260920-140500.webm');
    const withAudio = buildTranscriptBlock(SEGS, AT, 3730, src);
    expect(withAudio.split('\n')[2]).toBe('<audio controls preload="metadata" src="assets/录音-20260920-140500.webm"></audio>');
    expect(withAudio).not.toMatch(/\n\s*\n/);
    const note = `# 周会\n\n- 我记的要点\n\n${withAudio}\n`;
    expect(htmlToMarkdown(markdownToHtml(note))).toContain(withAudio);
    expect(stripTranscriptBlocks(note)).toBe('# 周会\n\n- 我记的要点');
    // 同一场再放一次（录音变长了、地址不变）是替换
    expect(upsertBlock(note, withAudio, AT).match(/<audio /g)).toHaveLength(1);
  });

  it('区分了说话人：每句前面带名字；判断不了的那句不带；名字里的尖括号一样转义', () => {
    const segs = [{ start: 0, text: '开始吧。', speaker: 's1' }, { start: 3, text: '好的。', speaker: null }, { start: 5, text: '我这边提测了。', speaker: 's2' }];
    const names = { s1: '老王', s2: '<小李>' };
    expect(transcriptText(segs, names)).toBe('[00:00] 老王：开始吧。\n[00:03] 好的。\n[00:05] <小李>：我这边提测了。');
    const withNames = buildTranscriptBlock(segs, AT, 10, null, names);
    expect(withNames).toContain('<p>[00:00] 老王：开始吧。</p>');
    expect(withNames).toContain('<p>[00:03] 好的。</p>');
    expect(withNames).toContain('<p>[00:05] &lt;小李&gt;：我这边提测了。</p>');
    expect(parseClock('[00:05] <小李>：我这边提测了。')).toBe(5);
    // 没传名字（没开这个功能）就和原来一样
    expect(transcriptText(segs)).toBe('[00:00] 开始吧。\n[00:03] 好的。\n[00:05] 我这边提测了。');
  });

  it('从一行转写里读出时间戳', () => {
    expect(parseClock('[00:15] 然后是实时转写')).toBe(15);
    expect(parseClock(' [1:02:05] 散会。')).toBe(3725);
    expect(parseClock('转写全文 · 57 秒')).toBeNull();
    expect(parseClock('他说 [00:15] 的时候')).toBeNull();
  });

  it('富文本往返一遍，转写块一个字都不变（靠 26.2 的 HTML 块原样保留）', () => {
    const note = `# 周会\n\n- 我记的要点\n\n${block}\n`;
    expect(htmlToMarkdown(markdownToHtml(note))).toContain(block);
  });
});

describe('把转写和纪要放进笔记', () => {
  const block = buildTranscriptBlock(SEGS.slice(0, 1), AT, 10);

  it('追加到末尾，和正文之间留一个空行；空笔记不多出开头的空行', () => {
    expect(appendBlock('# 标题\n\n正文\n\n\n', block)).toBe(`# 标题\n\n正文\n\n${block}\n`);
    expect(appendBlock('', block)).toBe(`${block}\n`);
  });

  it('去掉转写块，剩下的是用户自己记的', () => {
    const note = appendBlock('# 周会\n\n- 排期要重排', block);
    expect(hasTranscriptBlock(note)).toBe(true);
    expect(stripTranscriptBlocks(note)).toBe('# 周会\n\n- 排期要重排');
    expect(hasTranscriptBlock('普通笔记 <details><summary>别的折叠块</summary></details>')).toBe(false);
  });

  it('同一场再放一次是替换，不是再追加一块；别的场次的转写块不动', () => {
    const other = buildTranscriptBlock([{ start: 0, text: '上周的会。' }], new Date(2026, 8, 13, 10, 0), 5);
    const note = appendBlock(appendBlock('# 周会', other), block);
    const longer = buildTranscriptBlock(SEGS, AT, 3730);
    const next = upsertBlock(note, longer, AT);
    expect(next.match(/<details data-iml-transcript>/g)).toHaveLength(2);
    expect(next).toContain(other);
    expect(next).toContain('散会。');
    expect(next.indexOf(other)).toBeLessThan(next.indexOf(longer));
    expect(upsertBlock('# 新笔记', block, AT)).toBe(appendBlock('# 新笔记', block));
  });

  it('纪要插在转写块前面；没有转写块就放末尾', () => {
    const note = appendBlock('# 周会\n\n- 要点', block);
    const withMinutes = insertMinutes(note, '### 待办\n- [ ] 重排排期');
    expect(withMinutes.indexOf('## 会议纪要')).toBeLessThan(withMinutes.indexOf('<details'));
    expect(withMinutes.indexOf('- 要点')).toBeLessThan(withMinutes.indexOf('## 会议纪要'));
    expect(withMinutes).toContain(block);
    expect(insertMinutes('# 没有转写', '内容')).toBe('# 没有转写\n\n## 会议纪要\n\n内容\n');
  });

  it('新建的会议笔记：属性、标题、留给用户记要点的位置、转写块', () => {
    const note = newMeetingNote('会议记录 2026-09-20 1405', AT, block);
    expect(note.startsWith('---\ntype: meeting\ndate: 2026-09-20\n')).toBe(true);
    expect(note).toContain('# 会议记录 2026-09-20 1405');
    expect(note.indexOf('## 要点')).toBeLessThan(note.indexOf('<details'));
    expect(note).not.toMatch(/^- *$/m);   // 不预放空的「- 」：空列表项在 Markdown 里不成立，会变成一个字面的减号
    // 刚开始转写时的骨架：还没有转写块
    expect(newMeetingNote('会议记录', AT)).toBe('---\ntype: meeting\ndate: 2026-09-20\ntags: [会议]\n---\n\n# 会议记录\n\n## 要点\n');
  });
});

describe('纪要的提示词', () => {
  it('长转写按行分段，不把一句话拦腰截断', () => {
    const text = Array.from({ length: 100 }, (_, i) => `[00:${String(i).padStart(2, '0')}] ${'话'.repeat(90)}`).join('\n');
    const parts = splitForSummary(text, 1000);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join('\n')).toBe(text);
    expect(splitForSummary('短的', 1000)).toEqual(['短的']);
  });

  it('用户自己记的要点放进去（用来判断轻重、纠正专有名词）；没记就不提', () => {
    const t = transcriptText(SEGS.slice(0, 2));
    expect(t).toBe('[00:00] 大家好，我们开始今天的周会。\n[00:03] 第一个议题是 26.3 的排期 <紧急> & 重要');
    const withNotes = buildMinutesMessages('- 排期要重排', t)[1].content;
    expect(withNotes).toContain('我在会上自己记的要点');
    expect(withNotes).toContain('对不上的内容是以前记的，不要写进纪要');
    expect(withNotes).toContain('- 排期要重排');
    expect(buildMinutesMessages('  ', t)[1].content).not.toContain('自己记的要点');
    // 小模型爱编负责人、爱把「下周三」算成具体日期（还算错）：提示词里两条都要管住
    const system = buildMinutesMessages('', t)[0].content;
    expect(system).toContain('不要写「未明确」');
    expect(system).toContain('不要自己推算成具体日期');
  });

  it('模型多写的东西不进笔记：外层代码围栏、重复的标题、末尾的「注：」', () => {
    const body = '### 议题与结论\n- 排期：先做问你的笔记\n\n### 待办\n- [ ] 技术验证（老王，下周三）';
    expect(cleanMinutes(`${body}\n\n---\n\n*注：「下周三」按会议日期推算为 9 月 19 日。*`)).toBe(body);
    expect(cleanMinutes(`${body}\n\n**备注**：以上根据转写整理。`)).toBe(body);
    expect(cleanMinutes('```markdown\n## 会议纪要\n\n' + body + '\n```')).toBe(body);
    expect(cleanMinutes(`${body}\n\n---`)).toBe(body);
    // 正文中间恰好有一行「说明：」，后面还有内容 —— 不能从这里砍掉
    const mid = '### 议题与结论\n\n说明：本次只讨论排期\n\n- 排期：先做问你的笔记';
    expect(cleanMinutes(mid)).toBe(mid);
    expect(cleanMinutes('  ')).toBe('');
  });

  it('小模型管不住的两样：会上没说的「未明确」去掉，写了两遍的小节合成一个', () => {
    const raw = [
      '### 议题与结论', '- 排期：先做问你的笔记', '',
      '### 待办', '- [ ] 发会议纪要到群里（负责人：未明确）', '- [ ] 技术验证结论（负责人：老王）', '- [ ] 保真度测试 —— 未明确负责人、截止时间', '',
      '### 下次会议', '- 9 月 22 日', '',
      '### 待办', '- [ ] 发会议纪要到群里', '- [ ] 技术验证结论（负责人：老王）', '- [ ] 重排排期（待定）',
    ].join('\n');
    expect(cleanMinutes(raw)).toBe([
      '### 议题与结论', '- 排期：先做问你的笔记', '',
      '### 待办', '- [ ] 发会议纪要到群里', '- [ ] 技术验证结论（负责人：老王）', '- [ ] 保真度测试', '- [ ] 重排排期', '',
      '### 下次会议', '- 9 月 22 日',
    ].join('\n'));
    // 正常的括号和破折号不能误伤
    expect(cleanMinutes('- [ ] 给出结论（老王，下周三前）—— 走子进程方案')).toBe('- [ ] 给出结论（老王，下周三前）—— 走子进程方案');
    expect(cleanMinutes('- 无线网络方案：沿用现有的')).toBe('- 无线网络方案：沿用现有的');
  });

  it('同一件事换个括号写法再说一遍，只留第一条', () => {
    expect(cleanMinutes('### 待办\n- [ ] 给出结论（下周三之前，老王）\n\n- [ ] 给出结论（负责人：老王，截止时间：下周三之前）\n- [ ] 发纪要')).toBe('### 待办\n- [ ] 给出结论（下周三之前，老王）\n- [ ] 发纪要');
  });

  it('交给模型的笔记先收拾：属性区、勾掉的任务、行内标签不带', () => {
    const note = '---\ntags: [会议]\n---\n\n# 周会\n\n- [x] 26.1 已发布\n- [ ] 主题定为「搬进来」 #会议\n- 老王负责打包验证\n\nC# 和 issue #12 不是标签';
    expect(notesForMinutes(note)).toBe('# 周会\n\n- [ ] 主题定为「搬进来」\n- 老王负责打包验证\n\nC# 和 issue #12 不是标签');
  });

  it('合并各段提炼时保持时间顺序', () => {
    const c = buildMergeMessages('', ['第一段的要点', '第二段的要点'])[1].content;
    expect(c.indexOf('【第 1 段】')).toBeLessThan(c.indexOf('【第 2 段】'));
  });
});
