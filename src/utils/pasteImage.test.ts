import { describe, expect, it, beforeEach } from 'vitest';
import { createMockApi } from '../test/setup';
import { useAppStore } from '../stores/appStore';
import { persistDataUrl, storeImageFile } from './pasteImage';
import { htmlToMarkdown, markdownToHtml } from './markdown';

const initialState = useAppStore.getInitialState();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const png = (name = '截图.png') => new File([PNG], name, { type: 'image/png' });
const DATA_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

let api: ReturnType<typeof createMockApi>;
beforeEach(() => {
  useAppStore.setState({ ...initialState, tabs: [], expandedPaths: [], recentFiles: [] }, true);
  api = createMockApi({ '/lib/a.md': '' });
  api.fs.saveImage.mockImplementation(async (_owner: string, name: string) => ({ success: true, path: `assets/${name}`, bytes: PNG.length }));
  (window as any).api = api;
});

describe('图片存放位置', () => {
  it('默认：存进文档旁的 assets/，正文里是相对路径；文档没保存过就不插，说清楚该做什么', async () => {
    expect(await storeImageFile(png(), '/lib/a.md')).toBe('assets/截图.png');
    expect(api.fs.saveImage).toHaveBeenCalledTimes(1);
    expect(await storeImageFile(png(), 'new-1')).toBeNull();
    expect(useAppStore.getState().notice?.text).toContain('先保存这篇文档');
  });

  it('选了「文档里」：不落文件，返回 data: 地址；文档没保存过也能插', async () => {
    useAppStore.setState({ imageStorage: 'inline' });
    expect(await storeImageFile(png(), '/lib/a.md')).toBe(DATA_URL);
    expect(await storeImageFile(png(), 'new-1')).toBe(DATA_URL);
    expect(api.fs.saveImage).not.toHaveBeenCalled();
    expect(useAppStore.getState().notice?.text).toBe('图片已写进文档：1 KB');
  });

  it('「插入图片」对话框里本地上传的（拿到的是 data: 地址）：跟着同一个设置走', async () => {
    expect(await persistDataUrl(DATA_URL, '/lib/a.md', '示意图')).toBe('assets/示意图.png');
    expect(await persistDataUrl(DATA_URL, 'new-1', '示意图')).toBeNull();
    useAppStore.setState({ imageStorage: 'inline' });
    expect(await persistDataUrl(DATA_URL, 'new-1', '示意图')).toBe(DATA_URL);
  });

  it('写进文档里的图片，富文本往返一遍不丢、不变', () => {
    const md = `前一段\n\n![示意图](${DATA_URL})\n\n后一段`;
    const html = markdownToHtml(md);
    expect(html).toContain(`src="${DATA_URL}"`);
    expect(htmlToMarkdown(html)).toContain(`![示意图](${DATA_URL})`);
  });

  it('设置里存的值不认识（旧版本、手改坏了）：按默认的来', async () => {
    api.app.getSettings.mockResolvedValue({ imageStorage: 'somewhere' } as never);
    await useAppStore.getState().loadSettings();
    expect(useAppStore.getState().imageStorage).toBe('assets');
    api.app.getSettings.mockResolvedValue({ imageStorage: 'inline' } as never);
    await useAppStore.getState().loadSettings();
    expect(useAppStore.getState().imageStorage).toBe('inline');
  });
});
