import { useAppStore } from '../stores/appStore';

/**
 * 拖进窗口的文件。
 * 页面收到的是 HTML5 的 drop 事件：只有文件名和内容，没有路径（WebView 从不告诉页面）。路径要再向壳问一次
 * （window.api.app.droppedPaths：macOS 读系统的拖放剪贴板，Windows 在 WebView2 的接收器外面记了一份），按名字对上。
 * 图片不归这里：两种模式的编辑器自己接，插到光标落点。
 */

export interface DroppedPath { path: string; isDirectory: boolean }

const DOC_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || '';

/** 拖的是不是磁盘上的文件（页面内拖文字、拖图片节点不算） */
export function isFileDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files');
}

/** 页面只知道文件名，壳知道路径：按名字一一对上；同名的按顺序，对不上的丢掉 */
export function matchPaths(files: File[], dropped: DroppedPath[]): DroppedPath[] {
  const pool = [...dropped];
  const out: DroppedPath[] = [];
  for (const file of files) {
    const i = pool.findIndex((d) => baseName(d.path) === file.name);
    if (i >= 0) out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/** 文档打开成标签页；文件夹打开到侧边栏（拖了几个只开第一个）；别的说一声 */
export async function openDropped(items: DroppedPath[]): Promise<void> {
  const store = useAppStore.getState();
  const folder = items.find((d) => d.isDirectory);
  const docs = items.filter((d) => !d.isDirectory && DOC_RE.test(d.path));
  const others = items.filter((d) => !d.isDirectory && !DOC_RE.test(d.path));
  for (const doc of docs) await store.openFileByPath(doc.path);
  if (folder) {
    await store.loadFolder(folder.path);
    useAppStore.setState({ sidebarTab: 'files', sidebarVisible: true });
  }
  if (others.length) store.notify(`打不开 ${baseName(others[0].path)}：只认 Markdown 和纯文本文件`);
}

/** 非图片的文件：向壳问路径、对上名字、打开。壳给不出路径（拖来的不是磁盘上的文件）就说一声 */
export async function handleDroppedFiles(files: File[]): Promise<void> {
  const matched = matchPaths(files, await window.api.app.droppedPaths());
  if (matched.length === 0) {
    useAppStore.getState().notify(`打不开 ${files[0].name}：拿不到它在磁盘上的位置，改用「打开」菜单`);
    return;
  }
  await openDropped(matched);
}

/**
 * 装到 window 上。dragover 放行所有文件拖拽（不放行的话在侧边栏、预览这些地方松手，drop 不会发出来）；
 * drop 在冒泡阶段处理——编辑器先接图片（接到了会 preventDefault），非图片的文件归这里
 */
export function installFileDrop(): () => void {
  const onDragOver = (e: DragEvent) => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    if (!isFileDrag(e.dataTransfer)) return;
    const files = Array.from(e.dataTransfer?.files || []);
    const takenByEditor = e.defaultPrevented;
    e.preventDefault(); // 不拦的话 WebView 会把文件当网页打开
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (others.length === 0) {
      if (files.length && !takenByEditor) useAppStore.getState().notify('把图片拖到正文里，才会插进文档');
      return;
    }
    handleDroppedFiles(others).catch((err) => console.warn('[drop]', err));
  };
  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragover', onDragOver, true);
    window.removeEventListener('drop', onDrop);
  };
}
