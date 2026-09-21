import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

/**
 * KaTeX 的样式表给每种字体列了 woff2 / woff / ttf 三个地址，浏览器只会用第一个认得的。
 * 这个应用跑的地方（Chromium、macOS 的 WebKit、Windows 的 WebView2）全都认 woff2，后两种 800 KB 是白带的——不放进产物
 */
const dropLegacyKatexFonts = {
  name: 'drop-legacy-katex-fonts',
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) if (/KaTeX_[^/]*\.(ttf|woff)$/.test(file)) delete bundle[file];
  },
};

export default defineConfig({
  plugins: [react(), dropLegacyKatexFonts],
  // Tauri 壳里没有 preload 可以同步问主进程要版本号，构建时直接写进去
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Tauri 的 Rust 工程在 src-tauri/ 里，编译产物几个 G，别让开发服务器去盯
  server: { watch: { ignored: ['**/src-tauri/**'] } },
  build: {
    outDir: 'dist',
  },
  base: './', // Electron 从 file:// 加载，必须是相对路径；Tauri 两种都行
});
