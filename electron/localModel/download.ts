import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';

export type DownloadPhase = 'downloading' | 'verifying';

export interface DownloadProgress {
  received: number;
  total: number;
  /** 字节 / 秒（校验阶段为 0） */
  speed: number;
  phase: DownloadPhase;
}

export interface DownloadOptions {
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  /** 已知的文件大小：用于进度条与完整性校验 */
  expectedSize?: number;
  /** 完成后按 SHA256 校验；不符则删除文件 */
  sha256?: string;
  /** 校验文件头是不是 GGUF（防止把镜像站的错误页当模型存下来） */
  checkGguf?: boolean;
  headers?: Record<string, string>;
}

export type DownloadErrorCode = 'aborted' | 'http' | 'network' | 'size' | 'hash' | 'format';

export class DownloadError extends Error {
  constructor(message: string, public code: DownloadErrorCode) {
    super(message);
    this.name = 'DownloadError';
  }
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/** 发起 GET，自动跟随重定向（Hugging Face 会 302 到 CDN，Range 头一并带过去） */
function openStream(url: string, headers: Record<string, string>, signal?: AbortSignal, redirects = 0): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DownloadError('已取消', 'aborted'));
    const mod = url.startsWith('https:') ? https : http;
    let settled = false;
    const req = mod.get(url, { headers: { 'User-Agent': 'iML-Markdown-Editor', ...headers } }, (res) => {
      const status = res.statusCode ?? 0;
      if (REDIRECT_CODES.has(status) && res.headers.location && redirects < 10) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        settled = true;
        openStream(next, headers, signal, redirects + 1).then(resolve, reject);
        return;
      }
      settled = true;
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new DownloadError('连接超时', 'network')));
    req.on('error', (err: any) => {
      if (settled) return;
      settled = true;
      reject(err instanceof DownloadError ? err : new DownloadError(`网络错误：${err.message}`, 'network'));
    });
    const onAbort = () => req.destroy(new DownloadError('已取消', 'aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
  });
}

async function hashFile(file: string, signal?: AbortSignal, onProgress?: (done: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
    let done = 0;
    let lastEmit = 0;
    const onAbort = () => stream.destroy(new DownloadError('已取消', 'aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
      done += chunk.length;
      const now = Date.now();
      if (now - lastEmit > 400) { lastEmit = now; onProgress?.(done); }
    });
    stream.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
    stream.on('end', () => { signal?.removeEventListener('abort', onAbort); resolve(hash.digest('hex')); });
  });
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const fd = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fd.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

/**
 * 断点续传下载：数据先写到 <dest>.part，中途取消 / 断网后再次调用会从已下载的位置继续；
 * 下载完成并通过大小 / SHA256 校验后改名为 dest。
 */
export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const part = `${dest}.part`;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });

  let received = 0;
  try { received = (await fs.promises.stat(part)).size; } catch { received = 0; }
  if (opts.expectedSize && received > opts.expectedSize) {
    await fs.promises.unlink(part).catch(() => {});
    received = 0;
  }

  const res = await openStream(url, { ...(opts.headers || {}), ...(received > 0 ? { Range: `bytes=${received}-` } : {}) }, opts.signal);
  const status = res.statusCode ?? 0;
  let total = 0;
  let append = false;

  if (status === 206) {
    append = true;
    const m = /bytes \d+-\d+\/(\d+)/.exec(String(res.headers['content-range'] || ''));
    total = m ? Number(m[1]) : received + Number(res.headers['content-length'] || 0);
  } else if (status === 416) {
    // 服务端认为已经全部下完：跳过传输，直接进入校验
    res.resume();
    total = received;
  } else if (status === 200) {
    append = false;
    received = 0;
    total = Number(res.headers['content-length'] || 0);
  } else {
    res.resume();
    throw new DownloadError(`HTTP ${status}${status === 401 || status === 403 ? '（仓库需要登录或已受限）' : ''}`, 'http');
  }
  if (!total && opts.expectedSize) total = opts.expectedSize;

  if (status !== 416) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        if (err) { out.destroy(); reject(err); } else resolve();
      };
      const onAbort = () => { res.destroy(); finish(new DownloadError('已取消', 'aborted')); };
      const out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
      let lastEmit = Date.now();
      let lastBytes = received;
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= 400) {
          const speed = (received - lastBytes) / ((now - lastEmit) / 1000);
          lastEmit = now;
          lastBytes = received;
          opts.onProgress?.({ received, total, speed, phase: 'downloading' });
        }
      });
      res.on('error', (err: any) => finish(err instanceof DownloadError ? err : new DownloadError(`网络错误：${err.message}`, 'network')));
      res.on('close', () => {
        if (!res.complete) finish(new DownloadError(opts.signal?.aborted ? '已取消' : '连接中断，稍后可继续下载', opts.signal?.aborted ? 'aborted' : 'network'));
      });
      out.on('error', (err) => finish(new DownloadError(`写入失败：${err.message}`, 'network')));
      out.on('finish', () => finish());
      res.pipe(out);
    });
  }

  const size = (await fs.promises.stat(part)).size;
  if (opts.expectedSize && size !== opts.expectedSize) {
    if (size > opts.expectedSize) await fs.promises.unlink(part).catch(() => {});
    throw new DownloadError(`文件大小不符（已下载 ${size} 字节，应为 ${opts.expectedSize} 字节），请重试`, 'size');
  }
  if (opts.checkGguf) {
    const head = await readHead(part, 4);
    if (head.toString('ascii') !== 'GGUF') {
      await fs.promises.unlink(part).catch(() => {});
      throw new DownloadError('下载到的不是 GGUF 文件（可能是镜像站返回的网页），请换一个下载源', 'format');
    }
  }
  if (opts.sha256) {
    opts.onProgress?.({ received: 0, total: size, speed: 0, phase: 'verifying' });
    const actual = await hashFile(part, opts.signal, (done) => opts.onProgress?.({ received: done, total: size, speed: 0, phase: 'verifying' }));
    if (actual !== opts.sha256.toLowerCase()) {
      await fs.promises.unlink(part).catch(() => {});
      throw new DownloadError('SHA256 校验失败，已删除损坏的文件，请重新下载', 'hash');
    }
  }
  await fs.promises.rename(part, dest);
}
