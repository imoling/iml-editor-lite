export {};

import type { UpdateInfo } from '../../electron/update';
export type { UpdateInfo } from '../../electron/update';

declare global {
  interface Window {
    api: {
      dialog: {
        open: (options?: any) => Promise<string[] | null>;
        save: (options?: any) => Promise<string | null>;
      };
      fs: {
        readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string; filePath?: string }>;
        writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string; filePath?: string }>;
        readDir: (dirPath: string) => Promise<{ success: boolean; files?: any[]; error?: string; path?: string }>;
        saveImage: (activeFilePath: string, fileName: string, buffer: ArrayBuffer) => Promise<{ success: boolean; path?: string; bytes?: number; error?: string }>;
        rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; oldPath?: string; newPath?: string; error?: string }>;
        copy: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; sourcePath?: string; targetPath?: string; error?: string }>;
        delete: (path: string) => Promise<{ success: boolean; path?: string; permanently?: boolean; error?: string }>;
        exists: (path: string) => Promise<boolean>;
        mkdir: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      };
      export: {
        /** Tauri 壳走系统的打印面板：成功时是 printed，没有 path */
        pdf: (htmlContent: string, defaultPath: string, filePath: string) => Promise<{ success: boolean; path?: string; printed?: boolean; canceled?: boolean; error?: string }>;
        html: (htmlContent: string, defaultPath: string, filePath: string) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
        /** 渲染层生成好的文件（Word 文档）交给主进程问路径、写盘 */
        saveFile: (defaultName: string, bytes: Uint8Array, filterName: string, extension: string) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
        /** 分两步的导出（长图）：先问存哪——用户取消就不必白白生成；再把生成好的一份或几份写下去。几份时文件名自动加序号 */
        askPath: (defaultName: string, filterName: string, extension: string) => Promise<string | null>;
        writeFiles: (target: string, parts: Uint8Array[]) => Promise<{ success: boolean; paths?: string[]; error?: string }>;
        /** 用系统默认应用打开 / 在访达里选中一个刚导出的文件；只认这次运行里导出过的路径 */
        open: (filePath: string) => Promise<boolean>;
        reveal: (filePath: string) => Promise<boolean>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
        showItemInFolder: (path: string) => Promise<void>;
      };
      folder: {
        /** 监听侧边栏里打开的那个文件夹；传 null 停止监听 */
        watch: (dirPath: string | null) => Promise<boolean>;
      };
      web: {
        fetchTitle: (url: string) => Promise<string | null>;
        /** 取一张网上的图片（导出长图时要把图片内联进去；页面自己的 CSP 不让 fetch 任意网址）。只认 http(s)、不超过 12MB，失败返回 null */
        fetchImage: (url: string) => Promise<Uint8Array | null>;
      };
      events: {
        on: (channel: string, callback: (...args: any[]) => void) => void;
        send: (channel: string, ...args: any[]) => void;
      };
      app: {
        checkUpdates: () => Promise<UpdateInfo>;
        platform: string;
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        getSettings: () => Promise<any>;
        saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
        openSettings: () => void;
        consumePendingOpenFiles: () => Promise<string[]>;
        clearSession: () => void;
        previewSettings: (settings: any) => void;
        revertSettings: () => void;
      };
      appVersion: string;
      /** 只有 Tauri 壳有：本地图片地址的前缀（各平台写法不同）。Electron 壳用固定的 iml-asset://local/ */
      assetBase?: string;
      /** 只有 Tauri 壳有：系统 WebView 的画布编不出 WebP 时，把原图交给壳去压 */
      image?: { toWebp: (bytes: ArrayBuffer, maxWidth: number, maxHeight: number, quality: number) => Promise<ArrayBuffer | null> };
    };
  }
}
