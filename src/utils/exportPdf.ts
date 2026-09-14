import { useAppStore } from '../stores/appStore';
import { markdownToStaticHtml } from './markdown';

/** 把当前活动文档导出为 PDF（菜单与 ⌘P 共用） */
export async function exportActiveTabToPdf(): Promise<void> {
  // 编辑器写回是防抖的，导出前先刷新到 store
  useAppStore.getState().editorFlush?.();
  const { tabs, activeTabId } = useAppStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;
  const staticHtml = await markdownToStaticHtml(tab.content);
  await window.api.export.pdf(staticHtml, tab.title, tab.id);
}
