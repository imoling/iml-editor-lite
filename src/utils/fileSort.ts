import type { FileNode } from '../stores/appStore';

export type FileSortMode = 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc' | 'ctime-desc' | 'ctime-asc';

export const FILE_SORT_LABELS: Record<FileSortMode, string> = {
  'name-asc': '名称（A → Z）',
  'name-desc': '名称（Z → A）',
  'mtime-desc': '修改时间（新 → 旧）',
  'mtime-asc': '修改时间（旧 → 新）',
  'ctime-desc': '创建时间（新 → 旧）',
  'ctime-asc': '创建时间（旧 → 新）',
};

export const DEFAULT_FILE_SORT: FileSortMode = 'name-asc';
export const isFileSortMode = (v: unknown): v is FileSortMode => typeof v === 'string' && v in FILE_SORT_LABELS;

/** 「笔记 2」排在「笔记 10」前面；中文按系统语言的习惯（拼音）排 */
const byName = (a: FileNode, b: FileNode) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * 文件树里一层的排序。文件夹永远在前，且总是按名称排——按时间排的时候文件夹跳来跳去只会让人找不到东西。
 * 时间相同（或都拿不到）时退回按名称，保证顺序稳定。返回新数组，不改原数组。
 */
export function sortFileNodes(nodes: FileNode[], mode: FileSortMode): FileNode[] {
  const [field, dir] = mode.split('-') as ['name' | 'mtime' | 'ctime', 'asc' | 'desc'];
  const sign = dir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (a.isDirectory || field === 'name') return (a.isDirectory ? 1 : sign) * byName(a, b);
    const diff = (a[field] ?? 0) - (b[field] ?? 0);
    return diff !== 0 ? sign * diff : byName(a, b);
  });
}
