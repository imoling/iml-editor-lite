import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../stores/appStore';
import { exportActiveTabToPdf, exportActiveTabToImage, exportActiveTabToHtml } from './exportPdf';

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

  it('长图分成几张时只给「在访达中显示」，指向第一张', async () => {
    (window.api.export.image as any).mockResolvedValueOnce({ success: true, path: '/out/a-1.png', paths: ['/out/a-1.png', '/out/a-2.png'] });
    await exportActiveTabToImage();
    const notice = useAppStore.getState().notice!;
    expect(notice.text).toBe('笔记很长，分成了 2 张图');
    expect(notice.actions?.map((a) => a.label)).toEqual(['在访达中显示']);
    notice.actions![0].run();
    expect(window.api.export.reveal).toHaveBeenCalledWith('/out/a-1.png');
    expect(window.api.export.open).not.toHaveBeenCalled();
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
