/**
 * 必须是 main.tsx 的第一个 import：不少模块一加载就读 `window.api`（比如拿平台决定快捷键怎么写），
 * 得赶在它们之前装好。Electron 壳里 `window.api` 由 preload 提供，这里什么都不做。
 */
import { createTauriApi } from './tauriApi';

if (!window.api && '__TAURI_INTERNALS__' in window) {
  window.api = createTauriApi();
  document.documentElement.dataset.shell = 'tauri';
}
