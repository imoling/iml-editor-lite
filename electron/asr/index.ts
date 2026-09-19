import { app, ipcMain, BrowserWindow, systemPreferences, utilityProcess, type UtilityProcess } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ASR_RUNTIME_VERSION, GLUE_PACKAGE, MODEL_FILES, nativePackageFor, nativeDirName, npmTarballUrls, totalDownloadBytes, type AsrDownload } from './catalog';
import { downloadFile, DownloadError } from '../localModel/download';
import { extractArchive } from '../localModel/runtime';
import { resolveModelUrl } from '../localModel/catalog';
import { getDownloadSettings } from '../localModel';

/**
 * 实时转写（26.3）：管下载、管识别进程、在渲染进程和识别进程之间转发音频与文字。
 * 音频只在本机三个进程之间走：渲染进程采集 → 主进程转发 → 识别进程；不落盘、不联网。
 */

export type AsrSessionStatus = 'idle' | 'starting' | 'recording' | 'stopping';

export interface AsrState {
  /** 这个平台有没有对应的原生模块 */
  supported: boolean;
  installed: boolean;
  /** 总共要下载多少字节（界面上告诉用户） */
  downloadBytes: number;
  install: { active: boolean; received: number; total: number; step: string; error: string | null } | null;
  session: AsrSessionStatus;
  error: string | null;
}

interface Deps { isAiEnabled: () => boolean }

let deps: Deps | null = null;
let worker: UtilityProcess | null = null;
let session: AsrSessionStatus = 'idle';
let lastError: string | null = null;
let install: AsrState['install'] = null;
let installController: AbortController | null = null;

const rootDir = () => path.join(app.getPath('userData'), 'asr');
const runtimeDir = () => path.join(rootDir(), 'runtime', ASR_RUNTIME_VERSION);
const modelsDir = () => path.join(rootDir(), 'models');
const glueDir = () => path.join(runtimeDir(), 'sherpa-onnx-node');
const nativeDir = () => path.join(runtimeDir(), nativeDirName(process.platform, process.arch));
const modelPath = (file: string) => path.join(modelsDir(), file);

function isInstalled(): boolean {
  return fs.existsSync(path.join(glueDir(), 'sherpa-onnx.js'))
    && fs.existsSync(path.join(nativeDir(), 'sherpa-onnx.node'))
    && MODEL_FILES.every((f) => { try { return fs.statSync(modelPath(f.file)).size === f.size; } catch { return false; } });
}

export function getAsrState(): AsrState {
  return {
    supported: !!nativePackageFor(process.platform, process.arch),
    installed: isInstalled(),
    downloadBytes: totalDownloadBytes(process.platform, process.arch),
    install,
    session,
    error: lastError,
  };
}

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const state = getAsrState();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('asr:state', state);
  }, 100);
}

const sendEvent = (event: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('asr:event', event);
};

// ── 下载与安装 ───────────────────────────────────────────────────────────────

async function fetchWithFallback(urls: string[], dest: string, spec: AsrDownload, signal: AbortSignal, onBytes: (received: number) => void) {
  let lastErr: unknown = null;
  for (const url of urls) {
    // 每个地址给几次机会：小文件在镜像站上偶尔会卡住，断点续传接着下
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await downloadFile(url, dest, { expectedSize: spec.size, sha256: spec.sha256, signal, onProgress: (p) => onBytes(p.received ?? 0) });
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof DownloadError && err.code === 'aborted') throw err;
        if (!(err instanceof DownloadError) || err.code !== 'network') break;   // 校验不过、404 之类的换下一个地址
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  throw lastErr;
}

/** npm 的 tgz 解出来是一个 package/ 目录：解到临时目录，再把 package 挪成目标目录名 */
async function unpackNpm(archive: string, target: string) {
  const tmp = `${target}.unpack`;
  await fs.promises.rm(tmp, { recursive: true, force: true });
  await fs.promises.mkdir(tmp, { recursive: true });
  await extractArchive(archive, tmp);
  await fs.promises.rm(target, { recursive: true, force: true });
  await fs.promises.rename(path.join(tmp, 'package'), target);
  await fs.promises.rm(tmp, { recursive: true, force: true });
  await fs.promises.rm(archive, { force: true });
}

async function runInstall() {
  const native = nativePackageFor(process.platform, process.arch);
  if (!native) throw new Error('这个平台暂不支持实时转写');
  const controller = new AbortController();
  installController = controller;
  const total = totalDownloadBytes(process.platform, process.arch);
  let done = 0;
  const step = (name: string, received: number) => { install = { active: true, received: done + received, total, step: name, error: null }; broadcast(); };
  const { source, customBase } = getDownloadSettings();
  const preferOfficial = source === 'huggingface';

  await fs.promises.mkdir(runtimeDir(), { recursive: true });
  await fs.promises.mkdir(modelsDir(), { recursive: true });

  // 先下小的（运行时），再下大的（模型）：万一平台包有问题，不用等 200 多 MB 下完才知道
  for (const [pkg, target, label] of [[GLUE_PACKAGE, glueDir(), '识别组件'], [native, nativeDir(), '识别组件']] as const) {
    const archive = path.join(runtimeDir(), `${pkg.pkg}.tgz`);
    if (!fs.existsSync(path.join(target, pkg === GLUE_PACKAGE ? 'sherpa-onnx.js' : 'sherpa-onnx.node'))) {
      await fetchWithFallback(npmTarballUrls(pkg.pkg, preferOfficial), archive, pkg, controller.signal, (r) => step(label, r));
      step('解压', pkg.size);
      await unpackNpm(archive, target);
    }
    done += pkg.size;
  }
  for (const file of MODEL_FILES) {
    const dest = modelPath(file.file);
    let ok = false;
    try { ok = fs.statSync(dest).size === file.size; } catch { /* 还没下 */ }
    if (!ok) {
      const url = resolveModelUrl({ repo: file.repo, file: file.path }, source, customBase);
      await fetchWithFallback([url], dest, file, controller.signal, (r) => step('语音模型', r));
    }
    done += file.size;
  }
}

async function startInstall() {
  if (install?.active) return;
  lastError = null;
  install = { active: true, received: 0, total: totalDownloadBytes(process.platform, process.arch), step: '准备', error: null };
  broadcast();
  try {
    await runInstall();
    install = null;
  } catch (err: any) {
    const aborted = err instanceof DownloadError && err.code === 'aborted';
    install = aborted ? null : { active: false, received: install?.received ?? 0, total: install?.total ?? 0, step: '', error: err?.message || String(err) };
  } finally {
    installController = null;
    broadcast();
  }
}

// ── 识别进程 ─────────────────────────────────────────────────────────────────

function killWorker() {
  if (!worker) return;
  try { worker.kill(); } catch { /* 已经退出 */ }
  worker = null;
}

async function startSession(): Promise<AsrState> {
  if (session !== 'idle') return getAsrState();
  if (deps && !deps.isAiEnabled()) throw new Error('AI 功能已在设置里关闭');
  if (!isInstalled()) throw new Error('还没有下载转写组件');

  // macOS：麦克风要过系统这一关。用户之前点过「不允许」的话这里直接返回 false，只能去系统设置里改
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    if (!granted) throw new Error('没有麦克风权限：请到「系统设置 → 隐私与安全性 → 麦克风」里允许 iML Markdown Editor');
  }

  session = 'starting';
  lastError = null;
  broadcast();

  return new Promise<AsrState>((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'iML 实时转写', stdio: 'ignore' });
    worker = child;
    let settled = false;
    const fail = (message: string) => {
      lastError = message;
      if (worker === child) { killWorker(); session = 'idle'; }
      broadcast();
      if (!settled) { settled = true; reject(new Error(message)); } else sendEvent({ type: 'error', message });
    };
    const timer = setTimeout(() => fail('转写组件加载超时'), 30000);

    child.on('message', (m: any) => {
      if (m?.type === 'ready') {
        clearTimeout(timer);
        session = 'recording';
        broadcast();
        if (!settled) { settled = true; resolve(getAsrState()); }
      } else if (m?.type === 'error') {
        clearTimeout(timer);
        fail(`转写出错：${m.message}`);
      } else if (m?.type === 'partial' || m?.type === 'final' || m?.type === 'done') {
        sendEvent(m);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (worker !== child) return;          // 是我们自己停掉的
      worker = null;
      session = 'idle';
      if (code !== 0) fail(`转写进程意外退出（${code}）`);
      else broadcast();
    });
    child.once('spawn', () => {
      child.postMessage({
        type: 'init',
        glueDir: glueDir(),
        model: modelPath(MODEL_FILES[0].file),
        tokens: modelPath(MODEL_FILES[1].file),
        vad: modelPath(MODEL_FILES[2].file),
        // 识别是突发的短计算，两个线程够了；给多了只会和编辑器、对话模型抢核
        threads: Math.max(1, Math.min(2, os.cpus().length - 2)),
      });
    });
  });
}

async function stopSession(): Promise<AsrState> {
  const child = worker;
  if (!child || session === 'idle') { session = 'idle'; return getAsrState(); }
  session = 'stopping';
  broadcast();
  // 让它把最后一句吐出来再走；等不到就直接杀
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 4000);
    const onMessage = (m: any) => { if (m?.type === 'done') { clearTimeout(timer); resolve(); } };
    child.on('message', onMessage);
    try { child.postMessage({ type: 'finish' }); } catch { clearTimeout(timer); resolve(); }
  });
  if (worker === child) killWorker();
  session = 'idle';
  broadcast();
  return getAsrState();
}

/** 应用退出时调用 */
export function stopAsr() {
  installController?.abort();
  killWorker();
  session = 'idle';
}

export function setupAsr(d: Deps) {
  deps = d;
  ipcMain.handle('asr:getState', () => getAsrState());
  ipcMain.handle('asr:install', () => { void startInstall(); return true; });
  ipcMain.handle('asr:cancelInstall', () => { installController?.abort(); return true; });
  ipcMain.handle('asr:uninstall', async () => {
    await stopSession();
    await fs.promises.rm(rootDir(), { recursive: true, force: true });
    install = null;
    broadcast();
    return getAsrState();
  });
  ipcMain.handle('asr:start', () => startSession());
  ipcMain.handle('asr:stop', () => stopSession());
  // 音频块：每 100 ms 一块，用单向消息，不要回执
  ipcMain.on('asr:pcm', (_e, samples: Float32Array | ArrayBuffer) => {
    if (session !== 'recording' || !worker) return;
    try { worker.postMessage({ type: 'pcm', samples }); } catch { /* 进程正在退出 */ }
  });
}
