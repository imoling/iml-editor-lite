import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useAppStore } from '../stores/appStore';
import { exportActiveTabToPdf, exportActiveTabToHtml, exportActiveTabToImage } from './exportPdf';

// 画长图要真的排版和画布，jsdom 里没有；这里只管「问路径 → 生成 → 写盘 → 提示」这条流程
const renderLongImage = vi.fn();
vi.mock('./exportImage', () => ({ renderLongImage: (...args: unknown[]) => renderLongImage(...args) }));

const initialState = useAppStore.getInitialState();

beforeEach(() => {
  useAppStore.setState({ ...initialState, tabs: [{ id: '/lib/a.md', title: 'a.md', content: '# 甲\n\n正文', isDirty: false, mode: 'word' }], activeTabId: '/lib/a.md' }, true);
  (window.api.export.open as any).mockClear();
  (window.api.export.reveal as any).mockClear();
});

describe('导出成功后的提示', () => {
  it('导出 PDF：提示带「打开」和「在访达中显示」，点了就调用对应接口', async () => {
    (window.api.export.pdf as any).mockResolvedValueOnce({ success: true, path: '/out/a.pdf' });
    await exportActiveTabToPdf();
    const notice = useAppStore.getState().notice!;
    expect(notice.text).toBe('已导出 PDF');
    expect(notice.actions?.map((a) => a.label)).toEqual(['打开', '在访达中显示']);
    notice.actions![0].run();
    notice.actions![1].run();
    expect(window.api.export.open).toHaveBeenCalledWith('/out/a.pdf');
    expect(window.api.export.reveal).toHaveBeenCalledWith('/out/a.pdf');
  });

  it('长图：先问存哪，取消了就不生成；分成几张时只给「在访达中显示」，指向第一张', async () => {
    (window.api.export.askPath as any).mockResolvedValueOnce(null);
    await exportActiveTabToImage();
    expect(renderLongImage).not.toHaveBeenCalled();
    expect(useAppStore.getState().notice).toBeNull();

    const parts = [new Uint8Array([1]), new Uint8Array([2])];
    renderLongImage.mockResolvedValueOnce(parts);
    (window.api.export.askPath as any).mockResolvedValueOnce('/out/a.png');
    (window.api.export.writeFiles as any).mockResolvedValueOnce({ success: true, paths: ['/out/a-1.png', '/out/a-2.png'] });
    await exportActiveTabToImage();
    expect(window.api.export.askPath).toHaveBeenLastCalledWith('a.md', 'PNG 图片', 'png');
    expect(renderLongImage).toHaveBeenCalledWith(expect.stringContaining('甲'), '/lib');   // 相对路径的图片按文档所在目录解析
    expect(window.api.export.writeFiles).toHaveBeenCalledWith('/out/a.png', parts);
    const notice = useAppStore.getState().notice!;
    expect(notice.text).toBe('文档很长，分成了 2 张图');
    expect(notice.actions?.map((a) => a.label)).toEqual(['在访达中显示']);
    notice.actions![0].run();
    expect(window.api.export.reveal).toHaveBeenCalledWith('/out/a-1.png');
  });

  it('长图：只有一张时「打开」也给；画不出来时说清楚原因', async () => {
    renderLongImage.mockResolvedValueOnce([new Uint8Array([1])]);
    (window.api.export.askPath as any).mockResolvedValueOnce('/out/a.png');
    (window.api.export.writeFiles as any).mockResolvedValueOnce({ success: true, paths: ['/out/a.png'] });
    await exportActiveTabToImage();
    expect(useAppStore.getState().notice).toMatchObject({ text: '已导出长图' });
    expect(useAppStore.getState().notice!.actions?.map((a) => a.label)).toEqual(['打开', '在访达中显示']);

    renderLongImage.mockRejectedValueOnce(new Error('这篇文档里有长图画不出来的内容'));
    (window.api.export.askPath as any).mockResolvedValueOnce('/out/a.png');
    await exportActiveTabToImage();
    expect(useAppStore.getState().notice).toMatchObject({ text: '导出失败：这篇文档里有长图画不出来的内容' });
  });

  it('取消保存对话框：不提示；失败：提示错误、没有按钮', async () => {
    (window.api.export.html as any).mockResolvedValueOnce({ success: false, canceled: true });
    await exportActiveTabToHtml();
    expect(useAppStore.getState().notice).toBeNull();
    (window.api.export.html as any).mockResolvedValueOnce({ success: false, error: '磁盘满了' });
    await exportActiveTabToHtml();
    expect(useAppStore.getState().notice).toMatchObject({ text: '导出失败：磁盘满了' });
    expect(useAppStore.getState().notice?.actions).toBeUndefined();
  });
});
