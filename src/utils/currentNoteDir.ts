import { useAppStore } from '../stores/appStore';
import { noteDirOf } from './assetUrl';

/** 当前标签页里的相对路径该相对哪个目录解析；未落盘的新文档用「新建笔记会落到的目录」 */
export function currentNoteDir(): string | null {
  const state = useAppStore.getState();
  return noteDirOf(state.activeTabId, state.getNewNoteDir());
}

/** 保存图片时用的「所属笔记路径」：新文档还没有路径，借目标目录拼一个占位文件名 */
export function imageOwnerPath(tabId: string | null): string | null {
  if (!tabId) return null;
  if (!tabId.startsWith('new-')) return tabId;
  const dir = useAppStore.getState().getNewNoteDir();
  if (!dir) return null;
  return `${dir}${dir.includes('\\') ? '\\' : '/'}untitled.md`;
}
