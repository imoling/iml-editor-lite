import { useAppStore } from '../stores/appStore';

/**
 * 读一篇笔记的原文，给链接相关的功能用（小节补全、悬浮预览、嵌入）。
 * 已经打开的用标签页里的内容——没存盘的改动也要算；没打开的读磁盘。读不到返回 null。
 */
export async function readNoteForLink(path: string): Promise<string | null> {
  const tab = useAppStore.getState().tabs.find((t) => t.id === path);
  if (tab) return tab.content;
  try {
    const res = await window.api.fs.readFile(path);
    return res.success ? res.content || '' : null;
  } catch {
    return null;
  }
}
