export {};

import type { LocalState, LocalModelConfig, CustomModel, ServerState } from '../../electron/localModel/index';
export type { LocalState, LocalModelConfig, CustomModel, ServerState, LocalModelEntry, InstallState } from '../../electron/localModel/index';

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  reply: string;
  endpoint: string;
  model: string;
}

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}
export interface SearchResult {
  path: string;
  title: string;
  count: number;
  score: number;
  snippets: SearchSnippet[];
}
export interface BacklinkResult {
  path: string;
  title: string;
  snippets: SearchSnippet[];
}

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
        saveImage: (activeFilePath: string, fileName: string, buffer: ArrayBuffer) => Promise<{ success: boolean; path?: string; error?: string }>;
        rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; oldPath?: string; newPath?: string; error?: string }>;
        copy: (sourcePath: string, targetPath: string) => Promise<{ success: boolean; sourcePath?: string; targetPath?: string; error?: string }>;
        delete: (path: string) => Promise<{ success: boolean; path?: string; permanently?: boolean; error?: string }>;
        exists: (path: string) => Promise<boolean>;
        mkdir: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      };
      export: {
        pdf: (htmlContent: string, defaultPath: string, filePath: string) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
      };
      ai: {
        getConfig: () => Promise<any>;
        saveConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
        chat: (messages: any[], onStream: (chunk: string) => void, requestId: string, maxTokens?: number) => Promise<string>;
        stop: (requestId: string) => void;
        generateImage: (params: { prompt: string; config: any }) => Promise<{ url: string }[]>;
        listModels: (params: { endpoint: string; apiKey: string; protocol: string }) => Promise<string[]>;
        testConnection: (config: { protocol: string; endpoint: string; apiKey: string; model: string }) => Promise<ConnectionTestResult>;
      };
      local: {
        getState: () => Promise<LocalState>;
        installRuntime: (draft?: Partial<LocalModelConfig>) => Promise<boolean>;
        cancelInstall: () => Promise<boolean>;
        pickRuntime: () => Promise<string | null>;
        clearRuntimePath: () => Promise<boolean>;
        downloadModel: (id: string, draft?: Partial<LocalModelConfig>) => Promise<boolean>;
        cancelDownload: (id: string) => Promise<boolean>;
        deleteModel: (id: string) => Promise<void>;
        importModel: () => Promise<CustomModel | null>;
        start: (draft?: Partial<LocalModelConfig>) => Promise<ServerState>;
        stop: () => Promise<void>;
        switchBack: (target: string) => Promise<boolean>;
        getLogs: () => Promise<string[]>;
        test: (draft?: Partial<LocalModelConfig>) => Promise<ConnectionTestResult>;
        openModelsFolder: () => Promise<boolean>;
        onState: (callback: (state: LocalState) => void) => () => void;
        onLog: (callback: (line: string) => void) => () => void;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
        showItemInFolder: (path: string) => Promise<void>;
      };
      library: {
        watch: (dirPath: string) => Promise<boolean>;
      };
      search: {
        query: (query: string, limit?: number) => Promise<SearchResult[]>;
        status: () => Promise<{ root: string | null; count: number; building: boolean }>;
        listNotes: () => Promise<{ path: string; title: string }[]>;
        backlinks: (title: string) => Promise<BacklinkResult[]>;
      };
      events: {
        on: (channel: string, callback: (...args: any[]) => void) => void;
        send: (channel: string, ...args: any[]) => void;
      };
      app: {
        checkUpdates: () => Promise<{ success: boolean; latestVersion?: string; releaseUrl?: string; error?: string }>;
        platform: string;
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        getSettings: () => Promise<any>;
        saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
        openImageConfig: () => void;
        openSettings: () => void;
        consumePendingOpenFiles: () => Promise<string[]>;
        clearSession: () => void;
        getICloudLibraryPath: () => Promise<string | null>;
        previewSettings: (settings: any) => void;
        revertSettings: () => void;
      };
      appVersion: string;
    };
  }
}
