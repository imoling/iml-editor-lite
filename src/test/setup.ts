import { vi } from 'vitest';

// Mermaid 依赖浏览器绘图能力，测试里一律替换成空实现
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })), run: vi.fn(), parse: vi.fn() },
}));

/** 内存文件系统：测试 store 的文件相关逻辑时用它顶替 Electron 的 IPC 桥 */
export function createMockApi(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set<string>();
  for (const p of files.keys()) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') || '/');
  }
  const api = {
    files,
    dirs,
    fs: {
      readFile: vi.fn(async (p: string) =>
        files.has(p) ? { success: true, content: files.get(p), filePath: p } : { success: false, error: 'ENOENT' }),
      writeFile: vi.fn(async (p: string, content: string) => { files.set(p, content); return { success: true, filePath: p }; }),
      readDir: vi.fn(async (dir: string) => {
        if (!dirs.has(dir)) return { success: false, error: 'ENOENT' };
        const prefix = dir.endsWith('/') ? dir : dir + '/';
        const names = new Set<string>();
        const out: { name: string; path: string; isDirectory: boolean }[] = [];
        for (const p of [...files.keys(), ...dirs]) {
          if (!p.startsWith(prefix) || p === dir) continue;
          const rest = p.slice(prefix.length);
          const name = rest.split('/')[0];
          if (names.has(name)) continue;
          names.add(name);
          out.push({ name, path: prefix + name, isDirectory: dirs.has(prefix + name) });
        }
        return { success: true, files: out, path: dir };
      }),
      exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
      mkdir: vi.fn(async (p: string) => { dirs.add(p); return { success: true, path: p }; }),
      rename: vi.fn(async (a: string, b: string) => {
        if (files.has(a)) { files.set(b, files.get(a)!); files.delete(a); }
        if (dirs.has(a)) { dirs.delete(a); dirs.add(b); }
        return { success: true, oldPath: a, newPath: b };
      }),
      copy: vi.fn(async (a: string, b: string) => {
        if (files.has(b)) return { success: false, error: 'exists' };
        files.set(b, files.get(a) ?? '');
        return { success: true };
      }),
      delete: vi.fn(async (p: string) => { files.delete(p); dirs.delete(p); return { success: true, path: p }; }),
      saveImage: vi.fn(),
    },
    dialog: { open: vi.fn(async () => null), save: vi.fn(async () => null) },
    export: { pdf: vi.fn(), html: vi.fn(), saveFile: vi.fn(), askPath: vi.fn(async () => null), writeFiles: vi.fn(), open: vi.fn(async () => true), reveal: vi.fn(async () => true) },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    folder: { watch: vi.fn(async () => true) },
    web: { fetchTitle: vi.fn(async () => null), fetchImage: vi.fn(async () => null) },
    events: { on: vi.fn(), send: vi.fn() },
    app: {
      checkUpdates: vi.fn(async () => ({ success: false })),
      platform: 'darwin',
      minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      getSettings: vi.fn(async () => ({})),
      saveSettings: vi.fn(async () => ({ success: true })),
      openSettings: vi.fn(), previewSettings: vi.fn(), revertSettings: vi.fn(),
      consumePendingOpenFiles: vi.fn(async () => []),
      clearSession: vi.fn(),
    },
    appVersion: '26.1.0',
  };
  return api;
}

// 主进程模块的测试跑在 node 环境里，没有 window
if (typeof window !== 'undefined') (window as any).api = createMockApi();
