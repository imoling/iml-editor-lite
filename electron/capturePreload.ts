import { contextBridge, ipcRenderer } from 'electron';

/** 快速捕获小窗口只需要这三件事；它不加载应用本体，也拿不到 window.api */
contextBridge.exposeInMainWorld('capture', {
  submit: (text: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('capture:submit', text),
  close: () => ipcRenderer.send('capture:close'),
  onShow: (callback: () => void) => { ipcRenderer.on('capture:shown', () => callback()); },
});
