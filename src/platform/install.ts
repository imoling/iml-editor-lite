/**
 * 必须是 main.tsx 的第一个 import：不少模块一加载就读 `window.api`（比如拿平台决定快捷键怎么写），
 * 得赶在它们之前装好。不在 Tauri 壳里（`npm run dev:web` 直接开浏览器）就不装。
 */
import { createTauriApi } from './tauriApi';

if ('__TAURI_INTERNALS__' in window) window.api = createTauriApi();
