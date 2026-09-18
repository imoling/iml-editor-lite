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

/** 导出为单文件 HTML（本地图片内联，拷到哪里都能看）；frontmatter 作为属性卡片保留 */
export async function exportActiveTabToHtml(): Promise<void> {
  useAppStore.getState().editorFlush?.();
  const { tabs, activeTabId, notify } = useAppStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;
  const staticHtml = await markdownToStaticHtml(tab.content, { keepFrontmatter: true });
  const result = await window.api.export.html(staticHtml, tab.title, tab.id);
  if (result?.success) notify('已导出 HTML');
  else if (result && !result.canceled) notify(`导出失败：${result.error || '未知错误'}`);
}
