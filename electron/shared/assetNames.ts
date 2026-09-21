/** 粘贴 / 拖入的图片落盘时用什么名字。纯函数，不依赖 Node：Electron 主进程和 Tauri 壳的前端适配层共用这一份 */

const pad = (n: number) => String(n).padStart(2, '0');

/** 同 path.extname：最后一个点之后的部分；点在开头（.gitignore）不算扩展名 */
function extname(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

/**
 * 剪贴板里的截图统一叫 image.png，拖进来的文件名可能带空格（Markdown 地址里要转义）。
 * 这里给出落盘用的名字：通用名换成时间戳，空白换成 -，去掉路径非法字符。
 */
export function assetFileName(original: string, now = new Date()): string {
  const rawExt = extname(original);
  const ext = (rawExt || '.png').toLowerCase();
  const file = original.slice(Math.max(original.lastIndexOf('/'), original.lastIndexOf('\\')) + 1);
  let base = (rawExt ? file.slice(0, file.length - rawExt.length) : file).trim();
  if (!base || /^(image|img|untitled|blob|截屏|屏幕截图|screenshot|pasted[ -_]?image)$/i.test(base)) {
    base = `img-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
  base = base.replace(/[\\/:*?"<>|#%()[\]]/g, '').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'img';
  return `${base.slice(0, 80)}${ext}`;
}
