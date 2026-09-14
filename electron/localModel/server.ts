import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import net from 'net';
import http from 'http';

export interface ServerOptions {
  bin: string;
  modelPath: string;
  /** 对外暴露的模型名（OpenAI 兼容接口里的 model 字段） */
  alias: string;
  port: number;
  ctxSize: number;
  threads?: number | null;
  gpuLayers?: number | null;
  thinking: boolean;
  temperature?: number | null;
  /** 高级用户追加的原始参数，按 shell 规则切分 */
  extraArgs?: string;
}

/** 把 "--flash-attn on -b 512 --name 'a b'" 这样的字符串切成参数数组 */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function buildServerArgs(o: ServerOptions): string[] {
  const args = [
    '-m', o.modelPath,
    '-a', o.alias,
    '--host', '127.0.0.1',
    '--port', String(o.port),
    '-c', String(o.ctxSize),
    '--jinja',
    '--no-webui',
  ];
  args.push('-ngl', String(o.gpuLayers ?? 99));
  if (o.threads && o.threads > 0) args.push('-t', String(o.threads));
  if (!o.thinking) args.push('--reasoning-budget', '0');
  if (o.temperature != null && Number.isFinite(o.temperature)) args.push('--temp', String(o.temperature));
  args.push(...splitArgs(o.extraArgs || ''));
  return args;
}

/** 优先用指定端口；被占用就往后找一个空闲的 */
export function findFreePort(preferred: number, attempts = 20): Promise<number> {
  const tryPort = (port: number) => new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
  return (async () => {
    for (let i = 0; i < attempts; i++) {
      const port = preferred + i;
      if (await tryPort(port)) return port;
    }
    throw new Error(`端口 ${preferred} 起连续 ${attempts} 个都被占用`);
  })();
}

function httpJson(method: 'GET' | 'POST', url: string, body?: unknown, timeoutMs = 5000): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(url, {
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any = null;
        try { json = JSON.parse(text); } catch { json = text; }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 轮询 /health 直到模型加载完成；进程提前退出则立即失败 */
export async function waitForHealth(port: number, isAlive: () => boolean, timeoutMs = 240000, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('已取消');
    if (!isAlive()) throw new Error('进程已退出');
    try {
      const { status } = await httpJson('GET', `http://127.0.0.1:${port}/health`, undefined, 2000);
      if (status === 200) return;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('等待模型加载超时');
}

/** 发一条极短的对话验证服务可用，返回耗时与回复 */
export async function pingChat(port: number, model: string): Promise<{ latencyMs: number; reply: string }> {
  const started = Date.now();
  const { status, json } = await httpJson('POST', `http://127.0.0.1:${port}/v1/chat/completions`, {
    model,
    messages: [{ role: 'user', content: '用一个词回答：你好' }],
    max_tokens: 16,
    stream: false,
  }, 60000);
  if (status !== 200) throw new Error(typeof json === 'string' ? json : json?.error?.message || `HTTP ${status}`);
  const reply = String(json?.choices?.[0]?.message?.content ?? '').trim();
  return { latencyMs: Date.now() - started, reply };
}

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ServerState {
  status: ServerStatus;
  pid: number | null;
  port: number | null;
  modelId: string | null;
  modelName: string | null;
  alias: string | null;
  startedAt: number | null;
  error: string | null;
}

const MAX_LOG_LINES = 500;

/** 托管一个 llama-server 子进程：启动、等待就绪、收集日志、停止 */
export class LlamaServer extends EventEmitter {
  state: ServerState = { status: 'stopped', pid: null, port: null, modelId: null, modelName: null, alias: null, startedAt: null, error: null };
  logs: string[] = [];
  private child: ChildProcess | null = null;
  private starting: AbortController | null = null;

  private setState(patch: Partial<ServerState>) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  private pushLog(line: string) {
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    this.emit('log', line);
  }

  get isRunning() { return this.state.status === 'running'; }

  async start(opts: ServerOptions & { modelId: string; modelName: string }): Promise<ServerState> {
    if (this.state.status === 'starting') throw new Error('正在启动中');
    if (this.child) await this.stop();

    const port = await findFreePort(opts.port);
    const args = buildServerArgs({ ...opts, port });
    const cwd = path.dirname(opts.bin);
    const env = { ...process.env };
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [cwd, env.LD_LIBRARY_PATH].filter(Boolean).join(':');

    this.logs = [];
    this.pushLog(`$ ${path.basename(opts.bin)} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    const abort = new AbortController();
    this.starting = abort;

    const child = spawn(opts.bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.setState({ status: 'starting', pid: child.pid ?? null, port, modelId: opts.modelId, modelName: opts.modelName, alias: opts.alias, startedAt: Date.now(), error: null });

    const onLine = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) this.pushLog(line);
    };
    child.stdout?.on('data', onLine);
    child.stderr?.on('data', onLine);

    let exited = false;
    child.on('exit', (code, sig) => {
      exited = true;
      this.pushLog(`[进程退出] code=${code} signal=${sig ?? ''}`);
      if (this.child === child) {
        this.child = null;
        const wasRunning = this.state.status === 'running';
        this.setState({ status: wasRunning && code === 0 ? 'stopped' : (this.state.status === 'stopped' ? 'stopped' : 'error'), pid: null, error: wasRunning && code !== 0 ? `进程异常退出（code ${code}）` : this.state.error });
      }
    });
    child.on('error', (err) => {
      this.pushLog(`[启动失败] ${err.message}`);
      exited = true;
    });

    try {
      await waitForHealth(port, () => !exited, 240000, abort.signal);
      this.setState({ status: 'running', error: null });
    } catch (err: any) {
      const tail = this.logs.slice(-8).join('\n');
      await this.stop();
      const message = `${err.message}${tail ? `\n${tail}` : ''}`;
      this.setState({ status: 'error', error: message });
      throw new Error(message);
    } finally {
      this.starting = null;
    }
    return this.state;
  }

  async stop(): Promise<void> {
    this.starting?.abort();
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } resolve(); }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
      });
    }
    this.setState({ status: 'stopped', pid: null, startedAt: null });
  }
}
