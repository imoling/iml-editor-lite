import { describe, expect, it, beforeEach } from 'vitest';
import { expandEmbedsForExport } from './exportEmbeds';
import { markdownToStaticHtml } from './markdown';
import { useAppStore } from '../stores/appStore';

const FILES: Record<string, string> = {
  '/lib/周会.md': '# 项目周会\n\n## 本周\n\n本周的事。\n\n![](assets/图.png)\n\n## 下周\n\n下周的事。',
};

beforeEach(() => {
  const api = (window as any).api;
  api.search.listNotes = async () => [{ path: '/lib/周会.md', title: '项目周会' }];
  api.search.findAttachment = async (name: string) => (name === '截图.png' ? '/lib/附件/深/截图 1.png' : name === '录音.webm' ? '/lib/assets/录音-会议.webm' : null);
  api.fs.readFile = async (p: string) => (p in FILES ? { success: true, content: FILES[p] } : { success: false });
  useAppStore.setState({ tabs: [], activeTabId: null });
});

describe('导出时展开嵌入', () => {
  it('笔记小节展开成内容；里面的图片和直接嵌入的图片都换成绝对路径（导出管线认这个）', async () => {
    const html = await expandEmbedsForExport(await markdownToStaticHtml('# 首页\n\n![[周会#本周]]\n\n![[截图.png|300]]\n'), '/lib/首页.md');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('.note-embed__head')?.textContent).toBe('项目周会 › 本周');
    expect(doc.body.textContent).toContain('本周的事');
    expect(doc.body.textContent).not.toContain('下周的事');
    expect(doc.body.textContent).not.toContain('![[');
    const srcs = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['/lib/assets/图.png', '/lib/附件/深/截图 1.png']);
    expect(html).not.toContain('iml-asset://');
    expect((doc.querySelectorAll('img')[1] as HTMLElement).style.width).toBe('300px');
  });

  it('导出的文件里点不了：交互属性和加载标记都拿掉；录音换成一行说明；不存在的笔记留提示', async () => {
    const html = await expandEmbedsForExport(await markdownToStaticHtml('![[周会]]\n\n![[录音.webm]]\n\n![[没有这篇]]\n'), '/lib/首页.md');
    expect(html).not.toContain('data-wiki-link');
    expect(html).not.toContain('data-embed-token');
    expect(html).not.toContain('<audio');
    expect(html).toContain('🎙 录音：录音-会议.webm');
    expect(html).toContain('还没有这篇笔记');
  });

  it('没有嵌入的文档原样返回，不多做任何事', async () => {
    const plain = await markdownToStaticHtml('# 标题\n\n正文 [[链接]] 和 ![](a.png)');
    expect(await expandEmbedsForExport(plain, '/lib/a.md')).toBe(plain);
  });
});
