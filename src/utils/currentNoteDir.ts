import { useAppStore } from '../stores/appStore';
import { noteDirOf } from './assetUrl';

/** 当前标签页里的相对路径该相对哪个目录解析；未落盘的新文档用打开的文件夹（没有就是 null） */
export function currentNoteDir(): string | null {
  const state = useAppStore.getState();
  return noteDirOf(state.activeTabId, state.getNewNoteDir());
}

/** 保存图片时用的「所属文档路径」。还没存过盘的文档没有「旁边」可言，返回 null —— 先保存，图片才有地方放 */
export function imageOwnerPath(tabId: string | null): string | null {
  if (!tabId || tabId.startsWith('new-')) return null;
  return tabId;
}
