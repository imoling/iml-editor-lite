import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assetFileName, IMAGE_EXT_RE } from '../assets';
import { exportDocument } from '../shared/exportDoc';
import { numberedPath } from '../shared/imageTiles';

/**
 * 保存到哪。正式使用时问用户；开发时的冒烟测试（IML_SMOKE_EXPORT_DIR）直接存进指定目录——系统的保存对话框没法自动化。
 */
async function askSavePath(window: BrowserWindow, defaultName: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
  const smokeDir = process.env.NODE_ENV === 'development' ? process.env.IML_SMOKE_EXPORT_DIR : '';
  if (smokeDir) return path.join(smokeDir, path.basename(defaultName));
  const res = await dialog.showSaveDialog(window, { defaultPath: defaultName, filters: [filter] });
  return res.canceled || !res.filePath ? null : res.filePath;
}

/**
 * 这次运行里导出过的文件。状态栏提示上的「打开 / 在访达中显示」只认这里面的路径——渲染层不能拿任意路径来让系统打开。
 */
const exportedFiles = new Set<string>();
function rememberExported(...files: string[]) {
  for (const f of files) exportedFiles.add(path.normalize(f));
}
/** 打开导出的文件（系统默认应用）或在访达 / 资源管理器里选中它。冒烟测试时不真开，记到导出目录的 .opened.log 里供脚本核对 */
async function openExported(target: string, how: 'open' | 'reveal'): Promise<boolean> {
  const file = path.normalize(String(target || ''));
  if (!exportedFiles.has(file)) return false;
  const smokeDir = process.env.NODE_ENV === 'development' ? process.env.IML_SMOKE_EXPORT_DIR : '';
  if (smokeDir) { await fs.promises.appendFile(path.join(smokeDir, '.opened.log'), `${how} ${file}\n`); return true; }
  if (how === 'reveal') { shell.showItemInFolder(file); return true; }
  return (await shell.openPath(file)) === '';
}

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

export function setupFileSystemIPC() {
  // Open dialog to select an existing file or directory
  ipcMain.handle('dialog:open', async (event, options?: Electron.OpenDialogOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    // 冒烟测试：系统的文件选择框自动化点不了，IML_SMOKE_PICK=/path/to/file 让它直接「选中」这个文件（只在开发模式生效）
    if (process.env.NODE_ENV === 'development' && process.env.IML_SMOKE_PICK) return [process.env.IML_SMOKE_PICK];

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

  // Write file content
  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    try {
      const normalizedPath = path.normalize(filePath);
      await fs.promises.writeFile(normalizedPath, content, 'utf-8');
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
       
       const target = await askSavePath(window, defaultPath.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + '.pdf', { name: 'PDF Document', extensions: ['pdf'] });
       if (!target) return { success: false, canceled: true };
       
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
       
       await fs.promises.writeFile(target, pdfBuffer);
       printWindow.close();
       rememberExported(target);
       return { success: true, path: target };
    } catch (error: any) {
      console.error("PDF Export Error:", error);
      return { success: false, error: error.message };
    }
  });


  // 渲染层已经生成好的文件（Word 文档）：问用户存哪，写盘
  ipcMain.handle('export:saveFile', async (event, defaultName: string, bytes: Uint8Array, filterName: string, extension: string) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return { success: false, error: 'No window found' };
      const ext = String(extension || '').replace(/[^a-z0-9]/gi, '');
      const target = await askSavePath(window, String(defaultName || '未命名').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + '.' + ext, { name: String(filterName || ext), extensions: [ext] });
      if (!target) return { success: false, canceled: true };
      await fs.promises.writeFile(target, Buffer.from(bytes));
      rememberExported(target);
      return { success: true, path: target };
    } catch (error: any) {
      console.error('Save export error:', error);
      return { success: false, error: error.message };
    }
  });

  // Export to a single-file HTML（图片内联）
  ipcMain.handle('export:html', async (event, htmlContent: string, defaultPath: string, activeFilePath: string) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return { success: false, error: 'No window found' };
      const target = await askSavePath(window, defaultPath.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + '.html', { name: 'HTML', extensions: ['html'] });
      if (!target) return { success: false, canceled: true };
      const dirPath = !activeFilePath.startsWith('new-') ? path.dirname(activeFilePath) : os.homedir();
      const body = await inlineLocalImages(htmlContent, dirPath);
      await fs.promises.writeFile(target, exportDocument(body, path.basename(target, '.html')), 'utf8');
      rememberExported(target);
      return { success: true, path: target };
    } catch (error: any) {
      console.error('HTML Export Error:', error);
      return { success: false, error: error.message };
    }
  });

  // 分两步的导出（长图在界面里生成）：先问存哪，再写。写的时候只认刚问过的那个路径——界面不能借这个接口往任意位置写二进制文件
  const askedPaths = new Set<string>();
  ipcMain.handle('export:askPath', async (event, defaultName: string, filterName: string, extension: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const ext = String(extension || '').replace(/[^a-z0-9]/gi, '');
    const target = await askSavePath(window, String(defaultName || '未命名').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + '.' + ext, { name: String(filterName || ext), extensions: [ext] });
    if (target) askedPaths.add(path.normalize(target));
    return target;
  });
  ipcMain.handle('export:writeFiles', async (_event, target: string, parts: Uint8Array[]) => {
    try {
      const file = path.normalize(String(target || ''));
      if (!askedPaths.delete(file) || !Array.isArray(parts) || parts.length === 0) return { success: false, error: '保存位置不对' };
      const saved: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const out = numberedPath(file, i, parts.length);
        await fs.promises.writeFile(out, Buffer.from(parts[i]));
        saved.push(out);
      }
      rememberExported(...saved);
      return { success: true, paths: saved };
    } catch (error: any) {
      console.error('Export write error:', error);
      return { success: false, error: error.message };
    }
  });

  // 状态栏「已导出」提示上的两个按钮
  ipcMain.handle('export:open', (_event, target: string) => openExported(target, 'open'));
  ipcMain.handle('export:reveal', (_event, target: string) => openExported(target, 'reveal'));

  // Read directory
  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    try {
      const normalizedPath = path.normalize(dirPath);
      const dirents = await fs.promises.readdir(normalizedPath, { withFileTypes: true });
      // 带上修改 / 创建时间：文件树可以按时间排序。个别文件 stat 失败（权限、刚被删）不影响整个目录
      const files = await Promise.all(dirents.map(async (dirent) => {
        const full = path.join(dirPath, dirent.name);
        let mtime = 0;
        let ctime = 0;
        try { const st = await fs.promises.stat(path.normalize(full)); mtime = st.mtimeMs; ctime = st.birthtimeMs || st.ctimeMs; } catch { /* 留 0 */ }
        return { name: dirent.name, path: full, isDirectory: dirent.isDirectory(), mtime, ctime };
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

  // 是否存在（新建文档 / 文件夹时去重用）
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
