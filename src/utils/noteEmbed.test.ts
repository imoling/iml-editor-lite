import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadLinkedContent, fillEmbed, fillEmbeds } from './noteEmbed';
import { useAppStore } from '../stores/appStore';

const FILES: Record<string, string> = {
  '/lib/周会.md': '---\naliases: [例会]\n---\n\n# 项目周会\n\n开场。\n\n## 本周\n\n本周的事。 ^wk\n\n![](assets/图.png)\n\n## 下周\n\n下周的事。',
  '/lib/甲.md': '# 甲\n\n![[乙]]',
  '/lib/乙.md': '# 乙\n\n乙的内容。\n\n![[甲]]',
  '/lib/长.md': '# 长\n\n' + '一行内容。\n\n'.repeat(400),
};
const NOTES = [
  { path: '/lib/周会.md', title: '项目周会', aliases: ['例会'] },
  { path: '/lib/甲.md', title: '甲' },
  { path: '/lib/乙.md', title: '乙' },
  { path: '/lib/长.md', title: '长' },
];

beforeEach(() => {
  const api = (window as any).api;
  api.search.listNotes = async () => NOTES;
  api.search.findAttachment = async (name: string) => ({ '截图.png': '/lib/附件/截图.png', '录音.webm': '/lib/assets/录音.webm', '演示.mp4': '/lib/附件/演示.mp4', '合同 v2.pdf': '/lib/附件/合同 v2.pdf' } as Record<string, string>)[name] ?? null;
  api.search.openAttachment = vi.fn(async () => true);
  api.fs.readFile = async (p: string) => (p in FILES ? { success: true, content: FILES[p] } : { success: false });
  useAppStore.setState({ tabs: [], activeTabId: null });
  document.body.innerHTML = '';
});

const slot = (target: string, label = '') => {
  const el = document.createElement('div');
  el.setAttribute('data-wiki-embed', target);
  if (label) el.setAttribute('data-embed-label', label);
  document.body.appendChild(el);
  return el;
};

describe('loadLinkedContent', () => {
  it('整篇：去掉 frontmatter，图片地址按那篇笔记所在目录解析', async () => {
    const c = await loadLinkedContent('例会', { fromPath: '/lib/甲.md' });
    expect(c).toMatchObject({ kind: 'note', path: '/lib/周会.md', title: '项目周会', section: null, truncated: false });
    if (c.kind !== 'note') return;
    expect(c.html).toContain('<h1');
    expect(c.html).not.toContain('aliases');
    expect(c.html).toContain(encodeURIComponent('/lib/assets/图.png'));
  });

  it('#小节 / #^块 只取那一部分；[[#小节]] 指的是链接所在的那篇', async () => {
    const sec = await loadLinkedContent('周会#本周', { fromPath: null });
    expect(sec.kind === 'note' && sec.section).toBe('本周');
    expect(sec.kind === 'note' && sec.html.includes('本周的事') && !sec.html.includes('下周的事')).toBe(true);
    const blk = await loadLinkedContent('周会#^wk', { fromPath: null });
    expect(blk.kind === 'note' && blk.html.includes('本周的事') && !blk.html.includes('^wk')).toBe(true);
    const self = await loadLinkedContent('#下周', { fromPath: '/lib/周会.md' });
    expect(self.kind === 'note' && self.path === '/lib/周会.md' && self.html.includes('下周的事')).toBe(true);
  });

  it('打开着的笔记用标签页里的内容（没存盘的改动也算）', async () => {
    useAppStore.setState({ tabs: [{ id: '/lib/乙.md', title: '乙.md', content: '# 乙\n\n刚改的，还没存。', isDirty: true, mode: 'word' }] });
    const c = await loadLinkedContent('乙', { fromPath: null });
    expect(c.kind === 'note' && c.html.includes('刚改的')).toBe(true);
  });

  it('没有这篇 / 没有这一节，分开说；很长的内容截断', async () => {
    expect(await loadLinkedContent('不存在', { fromPath: null })).toEqual({ kind: 'missing', name: '不存在' });
    expect(await loadLinkedContent('周会#没有', { fromPath: null })).toMatchObject({ kind: 'no-section', title: '项目周会', section: '没有' });
    const long = await loadLinkedContent('长', { fromPath: null, maxChars: 500 });
    expect(long.kind === 'note' && long.truncated).toBe(true);
  });

  it('图片和音频按文件名在库里找', async () => {
    expect(await loadLinkedContent('截图.png', { fromPath: '/lib/甲.md' })).toMatchObject({ kind: 'image', path: '/lib/附件/截图.png' });
    expect(await loadLinkedContent('录音.webm', { fromPath: null })).toMatchObject({ kind: 'audio' });
    expect(await loadLinkedContent('没有.png', { fromPath: null })).toEqual({ kind: 'missing', name: '没有.png' });
  });
});

describe('fillEmbed', () => {
  it('笔记：标题栏可点（带 data-wiki-link），下面是渲染好的内容', async () => {
    const el = slot('周会#本周');
    await fillEmbed(el, '/lib/甲.md', ['/lib/甲.md']);
    expect(el.querySelector('.note-embed__head')?.getAttribute('data-wiki-link')).toBe('周会#本周');
    expect(el.querySelector('.note-embed__head')?.textContent).toBe('项目周会 › 本周');
    expect(el.querySelector('.note-embed__body')?.textContent).toContain('本周的事');
  });

  it('图片：尺寸写在竖线后面', async () => {
    const el = slot('截图.png', '300x200');
    await fillEmbed(el, '/lib/甲.md');
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toContain(encodeURIComponent('/lib/附件/截图.png'));
    expect([img.style.width, img.style.height]).toEqual(['300px', '200px']);
  });

  it('视频就地播放（|宽度 同样生效）；PDF 是一张文件卡片，「打开」交给系统默认应用', async () => {
    const v = slot('演示.mp4', '480');
    const f = slot('合同 v2.pdf');
    await Promise.all([fillEmbed(v, '/lib/甲.md'), fillEmbed(f, '/lib/甲.md')]);
    const video = v.querySelector('video')!;
    expect(video.controls).toBe(true);
    expect(video.getAttribute('src')).toContain(encodeURIComponent('/lib/附件/演示.mp4'));
    expect(video.style.width).toBe('480px');
    expect(f.querySelector('.note-embed__file-name')?.textContent).toBe('合同 v2.pdf');
    expect(f.querySelector('iframe, embed, object')).toBeNull();          // 不在窗口里渲染 PDF
    (f.querySelector('.note-embed__file-btn') as HTMLElement).click();
    expect((window as any).api.search.openAttachment).toHaveBeenCalledWith('/lib/附件/合同 v2.pdf');
  });

  it('互相嵌入：甲嵌乙、乙又嵌甲，到第二层停下，不会无限套', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-wiki-embed="乙"></div>';
    document.body.appendChild(root);
    await fillEmbeds(root, '/lib/甲.md');
    expect(root.textContent).toContain('乙的内容');
    expect(root.textContent).toContain('嵌入了它自己');
    expect(root.querySelectorAll('[data-wiki-embed]')).toHaveLength(2);
  });

  it('不存在的笔记、不存在的小节给提示，不留空白', async () => {
    const a = slot('没这篇');
    const b = slot('周会#没这节');
    await Promise.all([fillEmbed(a, null), fillEmbed(b, null)]);
    expect(a.textContent).toContain('还没有这篇笔记');
    expect(b.textContent).toContain('没有「没这节」这一节');
  });

  it('同一个占位连着填两次，后发的说了算', async () => {
    const el = slot('甲');
    const first = fillEmbed(el, null);
    el.setAttribute('data-wiki-embed', '周会#下周');
    const second = fillEmbed(el, null);
    await Promise.all([first, second]);
    expect(el.querySelector('.note-embed__head')?.textContent).toBe('项目周会 › 下周');
  });
});
