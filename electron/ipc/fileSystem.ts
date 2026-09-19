import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NoteHistory } from '../history';
import { assetFileName, IMAGE_EXT_RE, AUDIO_EXT_RE } from '../assets';

/** 导出（PDF / HTML）共用的样式：与应用内预览保持同一套语义（提示块、目录、标签、属性卡片、脚注） */
const EXPORT_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #333; line-height: 1.7; max-width: 860px; margin: 0 auto; }
  img { max-width: 100%; border-radius: 8px; margin: 10px 0; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
  code { font-family: 'Menlo', 'Monaco', monospace; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; margin: 20px 0; }
  th, td { border: 1px solid #ddd; padding: 10px 12px; text-align: left; }
  th { background-color: #f8f9fa; }
  h1, h2, h3 { color: #111; margin-top: 1.5em; }
  blockquote { margin: 1em 0; padding: 2px 16px; border-left: 3px solid #d0d7de; color: #57606a; }
  mark { background: #fff3a3; padding: 0 2px; border-radius: 2px; }
  kbd { font: 0.85em Menlo, monospace; padding: 1px 5px; border: 1px solid #d0d7de; border-bottom-width: 2px; border-radius: 4px; background: #f6f8fa; }
  .callout { margin: 1em 0; padding: 10px 14px; border-radius: 8px; border-left: 4px solid #6366f1; background: #eef2ff; break-inside: avoid; }
  .callout__title { font-weight: 600; margin-bottom: 4px; color: #4338ca; }
  .callout__body > :first-child { margin-top: 0; } .callout__body > :last-child { margin-bottom: 0; }
  .callout--tip { border-color: #10b981; background: #ecfdf5; } .callout--tip .callout__title { color: #047857; }
  .callout--important { border-color: #8b5cf6; background: #f5f3ff; } .callout--important .callout__title { color: #6d28d9; }
  .callout--warning { border-color: #f59e0b; background: #fffbeb; } .callout--warning .callout__title { color: #b45309; }
  .callout--caution { border-color: #ef4444; background: #fef2f2; } .callout--caution .callout__title { color: #b91c1c; }
  .toc-block { margin: 1em 0; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
  .toc-block__item { display: block; color: #4f46e5; text-decoration: none; line-height: 1.9; }
  .tag-chip { color: #4f46e5; background: #eef2ff; border-radius: 10px; padding: 0 7px; font-size: 0.92em; }
  .wiki-link { color: #4f46e5; }
  .frontmatter-card { margin: 0 0 1.5em; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.9em; color: #57606a; }
  .frontmatter-card__row { display: flex; gap: 12px; line-height: 1.9; } .frontmatter-card__key { min-width: 80px; color: #8b949e; }
  .frontmatter-card__chip { display: inline-block; margin-right: 6px; padding: 0 8px; border-radius: 10px; background: #f0f2f5; }
  .footnotes { margin-top: 2em; padding-top: 0.8em; border-top: 1px solid #e5e7eb; font-size: 0.9em; color: #57606a; }
  .footnote-ref { color: #4f46e5; }
  .math-block { text-align: center; margin: 1em 0; }
`;

const exportDocument = (htmlContent: string, title: string, baseHref?: string) => `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>${title.replace(/[<>&]/g, '')}</title>
    ${baseHref ? `<base href="${baseHref}">` : ''}
    <style>${EXPORT_CSS}</style>
  </head>
  <body>${htmlContent}</body>
</html>`;

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff' };

/** 单文件 HTML：把本地图片读进来内联成 data URL，拷到哪里都能看 */
async function inlineLocalImages(html: string, baseDir: string): Promise<string> {
  const srcs = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) srcs.add(m[1]);
  let out = html;
  for (const src of srcs) {
    if (/^(https?:|data:|blob:)/i.test(src)) continue;
    let rel = src.replace(/&amp;/g, '&');
    try { rel = decodeURI(rel); } catch { /* 保持原样 */ }
    if (/^file:\/\//i.test(rel)) rel = rel.replace(/^file:\/\//i, '');
    const abs = path.isAbsolute(rel) ? rel : path.join(baseDir, rel);
    if (!IMAGE_EXT_RE.test(abs)) continue;
    try {
      const stat = await fs.promises.stat(abs);
      if (stat.size > 12 * 1024 * 1024) continue;
      const mime = MIME[path.extname(abs).slice(1).toLowerCase()] || 'application/octet-stream';
      const data = (await fs.promises.readFile(abs)).toString('base64');
      out = out.split(`src="${src}"`).join(`src="data:${mime};base64,${data}"`);
    } catch { /* 找不到的图片保持原地址 */ }
  }
  return out;
}

export interface FileSystemDeps {
  history?: NoteHistory;
}

export function setupFileSystemIPC(deps: FileSystemDeps = {}) {
  const { history } = deps;
  // Open dialog to select an existing file or directory
  ipcMain.handle('dialog:open', async (event, options?: Electron.OpenDialogOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      ...options,
      properties: options?.properties || ['openFile', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    
    return result.filePaths;
  });

  // Save dialog
  ipcMain.handle('dialog:save', async (event, options?: Electron.SaveDialogOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const result = await dialog.showSaveDialog(window, {
      ...options,
      filters: options?.filters || [{ name: 'Markdown', extensions: ['md'] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return result.filePath;
  });

  // Read file content
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    try {
      const normalizedPath = path.normalize(filePath);
      const content = await fs.promises.readFile(normalizedPath, 'utf-8');
      return { success: true, content, filePath: normalizedPath };
    } catch (error: any) {
      console.error('Error reading file:', error);
      return { success: false, error: error.message };
    }
  });

  // Save an image buffer to disk relative to the active file
  ipcMain.handle('fs:saveImage', async (_, activeFilePath: string, fileName: string, buffer: ArrayBuffer) => {
    try {
      let dirPath: string;
      if (activeFilePath.startsWith('new-')) {
        dirPath = process.cwd();
      } else {
        dirPath = path.dirname(path.normalize(activeFilePath));
      }
      
      const assetsDir = path.join(dirPath, 'assets');
      if (!fs.existsSync(assetsDir)) {
         await fs.promises.mkdir(assetsDir, { recursive: true });
      }
      
      // 剪贴板截图统一叫 image.png：换成时间戳名；空格等字符换掉，Markdown 地址里不用转义
      const safeName = assetFileName(fileName);
      let uniqueName = safeName;
      let counter = 1;
      while (fs.existsSync(path.join(assetsDir, uniqueName))) {
        const ext = path.extname(safeName);
        const nameWithoutExt = path.basename(safeName, ext);
        uniqueName = `${nameWithoutExt}-${counter}${ext}`;
        counter++;
      }
      
      const fullPath = path.join(assetsDir, uniqueName);
      const data = Buffer.from(buffer);
      await fs.promises.writeFile(fullPath, data);
      // Return relative path for markdown
      return { success: true, path: `assets/${uniqueName}`, bytes: data.length };
    } catch (error: any) {
      console.error('Error saving image:', error);
      return { success: false, error: error.message };
    }
  });

  // 实时转写的录音：存到笔记旁边的 assets/。同一场转写再存一次是覆盖（停了又继续录，录音变长了），所以不加序号
  ipcMain.handle('fs:saveRecording', async (_, noteDir: string, fileName: string, buffer: ArrayBuffer) => {
    try {
      const safeName = path.basename(fileName).replace(/[\\/:*?"<>|#%()[\]\s]+/g, '-');
      if (!path.isAbsolute(noteDir) || !AUDIO_EXT_RE.test(safeName)) return { success: false, error: '录音的保存位置不对' };
      const assetsDir = path.join(path.normalize(noteDir), 'assets');
      await fs.promises.mkdir(assetsDir, { recursive: true });
      const data = Buffer.from(buffer);
      await fs.promises.writeFile(path.join(assetsDir, safeName), data);
      return { success: true, path: `assets/${safeName}`, bytes: data.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Write file content
  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    try {
      const normalizedPath = path.normalize(filePath);
      // 版本历史：覆盖前先给磁盘上的现状留底，写完再记新版本。历史出任何问题都不能挡住保存
      await history?.beforeOverwrite(normalizedPath, content).catch((err) => console.warn('[history] beforeOverwrite failed:', err));
      await fs.promises.writeFile(normalizedPath, content, 'utf-8');
      await history?.record(normalizedPath, content, 'save').catch((err) => console.warn('[history] record failed:', err));
      return { success: true, filePath: normalizedPath };
    } catch (error: any) {
      console.error('Error writing file:', error);
      return { success: false, error: error.message };
    }
  });

  // Export to PDF
  ipcMain.handle('export:pdf', async (event, htmlContent: string, defaultPath: string, activeFilePath: string) => {
    try {
       const window = BrowserWindow.fromWebContents(event.sender);
       if (!window) return { success: false, error: 'No window found' };
       
       const savePath = await dialog.showSaveDialog(window, {
         defaultPath: defaultPath.replace('.md', '.pdf'),
         filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
       });
       
       if (savePath.canceled || !savePath.filePath) return { success: false, canceled: true };
       
       const dirPath = !activeFilePath.startsWith('new-') ? path.dirname(activeFilePath) : os.homedir();
       const baseHref = `file:///${dirPath.replace(/\\/g, '/').replace(/^\//, '')}/`;

       const printWindow = new BrowserWindow({ 
         show: false, 
         webPreferences: { 
           nodeIntegration: false, 
           contextIsolation: true 
         } 
       });
       
       // data: 页面是不透明来源，加载不了 file:// 图片；写成临时文件再用 file:// 打开，<base> 指向笔记所在目录
       const tmpFile = path.join(os.tmpdir(), `iml-export-${Date.now()}.html`);
       await fs.promises.writeFile(tmpFile, exportDocument(htmlContent, path.basename(defaultPath), baseHref), 'utf8');
       try {
         await printWindow.loadFile(tmpFile);
       } finally {
         fs.promises.unlink(tmpFile).catch(() => {});
       }
       
       // Wait for images
       await new Promise(resolve => setTimeout(resolve, 800));

       const pdfBuffer = await printWindow.webContents.printToPDF({
          printBackground: true,
          margins: { top: 1, bottom: 1, left: 1, right: 1 }
       });
       
       await fs.promises.writeFile(savePath.filePath, pdfBuffer);
       printWindow.close();
       
       return { success: true, path: savePath.filePath };
    } catch (error: any) {
      console.error("PDF Export Error:", error);
      return { success: false, error: error.message };
    }
  });


  // Export to a single-file HTML（图片内联）
  ipcMain.handle('export:html', async (event, htmlContent: string, defaultPath: string, activeFilePath: string) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return { success: false, error: 'No window found' };
      const savePath = await dialog.showSaveDialog(window, {
        defaultPath: defaultPath.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + '.html',
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (savePath.canceled || !savePath.filePath) return { success: false, canceled: true };
      const dirPath = !activeFilePath.startsWith('new-') ? path.dirname(activeFilePath) : os.homedir();
      const body = await inlineLocalImages(htmlContent, dirPath);
      await fs.promises.writeFile(savePath.filePath, exportDocument(body, path.basename(savePath.filePath, '.html')), 'utf8');
      return { success: true, path: savePath.filePath };
    } catch (error: any) {
      console.error('HTML Export Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Read directory
  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    try {
      const normalizedPath = path.normalize(dirPath);
      const dirents = await fs.promises.readdir(normalizedPath, { withFileTypes: true });
      const files = dirents.map(dirent => ({
        name: dirent.name,
        path: path.join(dirPath, dirent.name),
        isDirectory: dirent.isDirectory()
      }));
      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      return { success: true, files, path: dirPath };
    } catch (error: any) {
      console.error('Error reading directory:', error);
      return { success: false, error: error.message };
    }
  });

  // 是否存在（新建笔记 / 文件夹时去重用）
  ipcMain.handle('fs:exists', async (_, targetPath: string) => fs.existsSync(path.normalize(targetPath)));

  // 新建文件夹
  ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
    try {
      const normalized = path.normalize(dirPath);
      if (fs.existsSync(normalized)) return { success: false, error: 'Target already exists' };
      await fs.promises.mkdir(normalized, { recursive: true });
      return { success: true, path: normalized };
    } catch (error: any) {
      console.error('Error creating directory:', error);
      return { success: false, error: error.message };
    }
  });

  // 在访达 / 资源管理器中显示
  ipcMain.handle('shell:showItemInFolder', async (_, targetPath: string) => {
    shell.showItemInFolder(path.normalize(targetPath));
  });

  // Rename or move file/directory
  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    try {
      const normalizedOld = path.normalize(oldPath);
      const normalizedNew = path.normalize(newPath);
      if (fs.existsSync(normalizedNew)) {
        return { success: false, error: 'Target already exists' };
      }
      await fs.promises.rename(normalizedOld, normalizedNew);
      await history?.rename(normalizedOld, normalizedNew).catch((err) => console.warn('[history] rename failed:', err));
      return { success: true, oldPath: normalizedOld, newPath: normalizedNew };
    } catch (error: any) {
      console.error('Error renaming:', error);
      return { success: false, error: error.message };
    }
  });

  // Copy file
  ipcMain.handle('fs:copy', async (_, sourcePath: string, targetPath: string) => {
    try {
      const normalizedSource = path.normalize(sourcePath);
      const normalizedTarget = path.normalize(targetPath);
      if (fs.existsSync(normalizedTarget)) {
        return { success: false, error: 'Target already exists' };
      }
      await fs.promises.copyFile(normalizedSource, normalizedTarget);
      return { success: true, sourcePath: normalizedSource, targetPath: normalizedTarget };
    } catch (error: any) {
      console.error('Error copying file:', error);
      return { success: false, error: error.message };
    }
  });

  // Delete file or directory (move to trash)
  ipcMain.handle('fs:delete', async (_, targetPath: string) => {
    try {
      const normalizedTarget = path.normalize(targetPath);
      await shell.trashItem(normalizedTarget);
      return { success: true, path: normalizedTarget };
    } catch (error: any) {
      console.error('Error deleting (trash):', error);
      // Fallback to unlink/rm if trash fails
      try {
        const stat = await fs.promises.stat(targetPath);
        if (stat.isDirectory()) {
          await fs.promises.rm(targetPath, { recursive: true, force: true });
        } else {
          await fs.promises.unlink(targetPath);
        }
        return { success: true, path: targetPath, permanently: true };
      } catch (fallbackError: any) {
        return { success: false, error: fallbackError.message };
      }
    }
  });
}
