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
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    saveConfig: (config: any) => ipcRenderer.invoke('ai:saveConfig', config),
    chat: (messages: any[], onStream: (chunk: string) => void, requestId: string, maxTokens?: number) => {
      const chunkListener = (_event: any, content: string) => onStream(content);
      ipcRenderer.on(`ai:chat-chunk-${requestId}`, chunkListener);
      return new Promise((resolve, reject) => {
        ipcRenderer.once(`ai:chat-done-${requestId}`, (_event, fullContent) => {
          ipcRenderer.removeListener(`ai:chat-chunk-${requestId}`, chunkListener);
          resolve(fullContent);
        });
        ipcRenderer.once(`ai:chat-error-${requestId}`, (_event, error) => {
          ipcRenderer.removeListener(`ai:chat-chunk-${requestId}`, chunkListener);
          reject(new Error(error));
        });
        ipcRenderer.send('ai:chat', { messages, requestId, maxTokens });
      });
    },
    stop: (requestId: string) => ipcRenderer.send('ai:stop', requestId),
    generateImage: (params: { prompt: string; config: any }) => ipcRenderer.invoke('ai:generateImage', params),
    listModels: (params: { endpoint: string; apiKey: string; protocol: string }): Promise<string[]> => ipcRenderer.invoke('ai:listModels', params),
    testConnection: (config: any) => ipcRenderer.invoke('ai:testConnection', config),
  },
  // 本机模型：编辑器托管的 llama-server 与 GGUF 模型
  local: {
    getState: () => ipcRenderer.invoke('local:getState'),
    installRuntime: (draft?: any) => ipcRenderer.invoke('local:installRuntime', draft),
    cancelInstall: () => ipcRenderer.invoke('local:cancelInstall'),
    pickRuntime: () => ipcRenderer.invoke('local:pickRuntime'),
    clearRuntimePath: () => ipcRenderer.invoke('local:clearRuntimePath'),
    downloadModel: (id: string, draft?: any) => ipcRenderer.invoke('local:downloadModel', id, draft),
    cancelDownload: (id: string) => ipcRenderer.invoke('local:cancelDownload', id),
    deleteModel: (id: string) => ipcRenderer.invoke('local:deleteModel', id),
    importModel: () => ipcRenderer.invoke('local:importModel'),
    start: (draft?: any) => ipcRenderer.invoke('local:start', draft),
    stop: () => ipcRenderer.invoke('local:stop'),
    switchBack: (target: string) => ipcRenderer.invoke('local:switchBack', target),
    getLogs: (): Promise<string[]> => ipcRenderer.invoke('local:getLogs'),
    test: (draft?: any) => ipcRenderer.invoke('local:test', draft),
    openModelsFolder: () => ipcRenderer.invoke('local:openModelsFolder'),
    onState: (callback: (state: any) => void) => {
      const listener = (_event: any, state: any) => callback(state);
      ipcRenderer.on('local:state', listener);
      return () => ipcRenderer.removeListener('local:state', listener);
    },
    onLog: (callback: (line: string) => void) => {
      const listener = (_event: any, line: string) => callback(line);
      ipcRenderer.on('local:log', listener);
      return () => ipcRenderer.removeListener('local:log', listener);
    },
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('open-url', url),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
  },
  library: {
    watch: (dirPath: string): Promise<boolean> => ipcRenderer.invoke('library:watch', dirPath),
  },
  search: {
    query: (query: string, limit?: number) => ipcRenderer.invoke('search:query', query, limit),
    status: () => ipcRenderer.invoke('search:status'),
    listNotes: () => ipcRenderer.invoke('search:listNotes'),
    backlinks: (title: string) => ipcRenderer.invoke('search:backlinks', title),
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
    openImageConfig: () => ipcRenderer.send('open:image-config'),
    openSettings: () => ipcRenderer.send('open:settings'),
    consumePendingOpenFiles: (): Promise<string[]> => ipcRenderer.invoke('app:consumePendingOpenFiles'),
    clearSession: () => ipcRenderer.send('app:clearSession'),
    getICloudLibraryPath: (): Promise<string | null> => ipcRenderer.invoke('app:getICloudLibraryPath'),
    previewSettings: (settings: any) => ipcRenderer.send('settings:preview', settings),
    revertSettings: () => ipcRenderer.send('settings:revert'),
    getWhatsNewState: (): Promise<{ current: string; lastSeen: string | null }> => ipcRenderer.invoke('app:getWhatsNewState'),
    markWhatsNewSeen: () => ipcRenderer.invoke('app:markWhatsNewSeen'),
  },
  appVersion,
});
