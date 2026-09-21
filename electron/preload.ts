import { contextBridge, ipcRenderer } from 'electron';

// 版本号由主进程从 package.json 读取，避免多处硬编码
const appVersion: string = ipcRenderer.sendSync('app:version');

contextBridge.exposeInMainWorld('api', {
  dialog: {
    open: (options?: Electron.OpenDialogOptions) => ipcRenderer.invoke('dialog:open', options),
    save: (options?: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:save', options),
  },
  fs: {
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
    saveImage: (activeFilePath: string, fileName: string, buffer: ArrayBuffer) => ipcRenderer.invoke('fs:saveImage', activeFilePath, fileName, buffer),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    copy: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('fs:copy', sourcePath, targetPath),
    delete: (path: string) => ipcRenderer.invoke('fs:delete', path),
    exists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', path),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
  },
  export: {
    pdf: (htmlContent: string, defaultPath: string, filePath: string) => ipcRenderer.invoke('export:pdf', htmlContent, defaultPath, filePath),
    html: (htmlContent: string, defaultPath: string, filePath: string) => ipcRenderer.invoke('export:html', htmlContent, defaultPath, filePath),
    saveFile: (defaultName: string, bytes: Uint8Array, filterName: string, extension: string) => ipcRenderer.invoke('export:saveFile', defaultName, bytes, filterName, extension),
    askPath: (defaultName: string, filterName: string, extension: string): Promise<string | null> => ipcRenderer.invoke('export:askPath', defaultName, filterName, extension),
    writeFiles: (target: string, parts: Uint8Array[]) => ipcRenderer.invoke('export:writeFiles', target, parts),
    open: (filePath: string): Promise<boolean> => ipcRenderer.invoke('export:open', filePath),
    reveal: (filePath: string): Promise<boolean> => ipcRenderer.invoke('export:reveal', filePath),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('open-url', url),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
  },
  folder: {
    /** 监听侧边栏里打开的那个文件夹；传 null 停止监听 */
    watch: (dirPath: string | null): Promise<boolean> => ipcRenderer.invoke('folder:watch', dirPath),
  },
  web: {
    fetchTitle: (url: string): Promise<string | null> => ipcRenderer.invoke('web:fetchTitle', url),
    fetchImage: (url: string): Promise<Uint8Array | null> => ipcRenderer.invoke('web:fetchImage', url),
  },
  events: {
    on: (channel: string, callback: (...args: any[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    },
    send: (channel: string, ...args: any[]) => {
      ipcRenderer.send(channel, ...args);
    }
  },
  app: {
    checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
    platform: process.platform,
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    getSettings: () => ipcRenderer.invoke('app:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('app:saveSettings', settings),
    openSettings: () => ipcRenderer.send('open:settings'),
    consumePendingOpenFiles: (): Promise<string[]> => ipcRenderer.invoke('app:consumePendingOpenFiles'),
    clearSession: () => ipcRenderer.send('app:clearSession'),
    previewSettings: (settings: any) => ipcRenderer.send('settings:preview', settings),
    revertSettings: () => ipcRenderer.send('settings:revert'),
  },
  appVersion,
});
