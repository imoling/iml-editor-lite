import { describe, expect, it } from 'vitest';
import { formatVersion, isNewerVersion } from './version';

describe('version', () => {
  it('隐藏末尾的 .0，保留补丁号', () => {
    expect(formatVersion('26.1.0')).toBe('26.1');
    expect(formatVersion('26.1.2')).toBe('26.1.2');
    expect(formatVersion('')).toBe('');
    expect(formatVersion(undefined)).toBe('');
  });

  it('逐段比较，旧的 GitHub 发布不会被当成新版本', () => {
    expect(isNewerVersion('1.9.0', '26.1.0')).toBe(false);
    expect(isNewerVersion('v26.2.0', '26.1.0')).toBe(true);
    expect(isNewerVersion('26.1.1', '26.1.0')).toBe(true);
    expect(isNewerVersion('26.1.0', '26.1.0')).toBe(false);
    expect(isNewerVersion('26.10.0', '26.9.0')).toBe(true);
    expect(isNewerVersion(undefined, '26.1.0')).toBe(false);
  });
});

describe('更新提醒里的发布说明摘要', () => {
  const NOTES = [
    '## 26.2.0 — 放心把笔记搬进来', '', '这一版只做一件事：让你敢把 **Obsidian**、Typora 里的笔记直接搬过来用。', '',
    '### 下载', '', '| 平台 | 安装包 |', '|---|---|', '| macOS | `a.dmg` |', '', '安装包未做 Apple 公证。', '',
    '### 保真：改一个字，只变一个字', '', '- 没编辑过的块直接写回原文', '',
    '### 版本历史 `⌘⇧H`', '', '- 每次保存留一个版本', '', '### 其它', '', '- 小修小补',
  ].join('\n');

  it('取标题里的一句话、开头那段、各小节标题；「下载」「其它」不算要点，Markdown 记号去掉', async () => {
    const { summarizeReleaseNotes } = await import('./version');
    expect(summarizeReleaseNotes(NOTES)).toEqual({
      slogan: '放心把笔记搬进来',
      lead: '这一版只做一件事：让你敢把 Obsidian、Typora 里的笔记直接搬过来用。',
      highlights: ['保真：改一个字，只变一个字', '版本历史 ⌘⇧H'],
    });
  });

  it('要点有上限；说明是空的、或不是这个写法，也给出空结果而不是报错', async () => {
    const { summarizeReleaseNotes } = await import('./version');
    const many = ['## 1.0 — x', ...Array.from({ length: 10 }, (_, i) => `### 第 ${i} 件事`)].join('\n');
    expect(summarizeReleaseNotes(many, 3).highlights).toEqual(['第 0 件事', '第 1 件事', '第 2 件事']);
    expect(summarizeReleaseNotes('')).toEqual({ slogan: '', lead: '', highlights: [] });
    expect(summarizeReleaseNotes(undefined)).toEqual({ slogan: '', lead: '', highlights: [] });
    expect(summarizeReleaseNotes('Bug fixes and improvements.')).toEqual({ slogan: '', lead: 'Bug fixes and improvements.', highlights: [] });
  });

  it('导语以 **加粗** 开头也认得；列表项、表格、引用、分割线仍然不算', async () => {
    const { summarizeReleaseNotes } = await import('./version');
    const s = summarizeReleaseNotes('## 26.4.0 — 打开，写，保存\n\n- 不是导语\n| 也 | 不是 |\n> 引用\n---\n**iML 编辑器**是轻量版。\n\n### 亮点一');
    expect(s).toMatchObject({ slogan: '打开，写，保存', lead: 'iML 编辑器是轻量版。', highlights: ['亮点一'] });
  });
});
