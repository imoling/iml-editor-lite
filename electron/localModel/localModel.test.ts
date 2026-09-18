// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { MODEL_CATALOG, resolveModelUrl, formatSize, formatContext } from './catalog';
import { checkRequirement } from './hardware';
import { pickRuntimeAsset, parseVersionOutput, applyProxy, findServerBinary } from './runtime';
import { buildServerArgs, splitArgs, findFreePort } from './server';
import { downloadFile, DownloadError } from './download';
import { normalizeLocalConfig, DEFAULT_LOCAL_CONFIG, inferServiceType } from './config';
import { inferServiceType as inferInRenderer } from '../../src/utils/aiService';

const GB = 1024 ** 3;

describe('catalog', () => {
  it('推荐清单的每一项都有完整的下载与校验信息', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.file.endsWith('.gguf')).toBe(true);
      expect(m.size).toBeGreaterThan(100 * 1024 * 1024);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.minRamGB).toBeGreaterThan(0);
    }
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(MODEL_CATALOG.length);
    expect(MODEL_CATALOG.filter((m) => m.recommended).length).toBe(1);
  });

  it('按下载源拼地址', () => {
    const spec = { repo: 'XHToken/Spark-X2.5-1.7B-GGUF', file: 'Spark-X2.5-1.7B-Q4_K_M.gguf' };
    expect(resolveModelUrl(spec, 'huggingface')).toBe('https://huggingface.co/XHToken/Spark-X2.5-1.7B-GGUF/resolve/main/Spark-X2.5-1.7B-Q4_K_M.gguf');
    expect(resolveModelUrl(spec, 'hf-mirror')).toBe('https://hf-mirror.com/XHToken/Spark-X2.5-1.7B-GGUF/resolve/main/Spark-X2.5-1.7B-Q4_K_M.gguf');
    expect(resolveModelUrl(spec, 'custom', 'https://mirror.example.com/hf/')).toBe('https://mirror.example.com/hf/XHToken/Spark-X2.5-1.7B-GGUF/resolve/main/Spark-X2.5-1.7B-Q4_K_M.gguf');
    // 自定义为空时退回镜像
    expect(resolveModelUrl(spec, 'custom', '')).toContain('hf-mirror.com');
  });

  it('大小与上下文的展示格式', () => {
    expect(formatSize(1107457856)).toBe('1.0 GB');
    expect(formatSize(688065920)).toBe('656 MB');
    expect(formatSize(4375021152)).toBe('4.1 GB');
    expect(formatSize(-1)).toBe('—');
    expect(formatContext(131072)).toBe('128k');
    expect(formatContext(4096)).toBe('4k');
    expect(formatContext(1048576)).toBe('1M');
  });
});

describe('hardware.checkRequirement', () => {
  const spec = { size: 4.1 * GB, minRamGB: 24, minCores: 8 };
  it('内存与核心都够 → ok', () => {
    expect(checkRequirement({ totalMemBytes: 24 * GB, cores: 10 }, spec).level).toBe('ok');
  });
  it('macOS 报的 24GB 实际略少于 24GB 也算满足', () => {
    expect(checkRequirement({ totalMemBytes: 24 * GB - 200 * 1024 * 1024, cores: 8 }, spec).level).toBe('ok');
  });
  it('内存不到建议值但够跑 → warn', () => {
    const r = checkRequirement({ totalMemBytes: 16 * GB, cores: 8 }, spec);
    expect(r.level).toBe('warn');
    expect(r.message).toContain('建议 24GB');
  });
  it('核心数不够也只是 warn', () => {
    const r = checkRequirement({ totalMemBytes: 32 * GB, cores: 4 }, spec);
    expect(r.level).toBe('warn');
    expect(r.message).toContain('核');
  });
  it('内存远远不够 → fail', () => {
    expect(checkRequirement({ totalMemBytes: 6 * GB, cores: 8 }, spec).level).toBe('fail');
    // 8GB 跑 4GB 的模型：勉强能跑，只是 warn
    expect(checkRequirement({ totalMemBytes: 8 * GB, cores: 8 }, spec).level).toBe('warn');
  });
});

describe('runtime', () => {
  const assets = [
    'cudart-llama-bin-win-cuda-12.4-x64.zip',
    'llama-b10936-bin-macos-arm64.tar.gz',
    'llama-b10936-bin-macos-x64.tar.gz',
    'llama-b10936-bin-ubuntu-arm64.tar.gz',
    'llama-b10936-bin-ubuntu-vulkan-x64.tar.gz',
    'llama-b10936-bin-ubuntu-x64.tar.gz',
    'llama-b10936-bin-win-cpu-arm64.zip',
    'llama-b10936-bin-win-cpu-x64.zip',
    'llama-b10936-bin-win-cuda-12.4-x64.zip',
    'llama-b10936-bin-win-vulkan-x64.zip',
    'llama-b10936-xcframework.zip',
  ].map((name) => ({ name }));

  it('按平台挑选发布包', () => {
    expect(pickRuntimeAsset('darwin', 'arm64', assets)).toBe('llama-b10936-bin-macos-arm64.tar.gz');
    expect(pickRuntimeAsset('darwin', 'x64', assets)).toBe('llama-b10936-bin-macos-x64.tar.gz');
    expect(pickRuntimeAsset('win32', 'x64', assets)).toBe('llama-b10936-bin-win-cpu-x64.zip');
    expect(pickRuntimeAsset('win32', 'arm64', assets)).toBe('llama-b10936-bin-win-cpu-arm64.zip');
    expect(pickRuntimeAsset('linux', 'x64', assets)).toBe('llama-b10936-bin-ubuntu-x64.tar.gz');
    expect(pickRuntimeAsset('linux', 'ia32', assets)).toBeNull();
    expect(pickRuntimeAsset('freebsd', 'x64', assets)).toBeNull();
  });

  it('解析 --version 输出', () => {
    expect(parseVersionOutput('version: 0.4.0-dev (build 10936, commit 790cf51aa)\nbuilt with AppleClang')).toBe('b10936');
    expect(parseVersionOutput('version: 6000 (abcdef0)\nbuilt with clang')).toBe('b6000');
    expect(parseVersionOutput('llama-server b5123')).toBe('b5123');
    expect(parseVersionOutput('')).toBeNull();
    expect(parseVersionOutput('something else entirely')).toBe('something else entirely');
  });

  it('GitHub 加速前缀', () => {
    const url = 'https://github.com/ggml-org/llama.cpp/releases/download/b1/x.tar.gz';
    expect(applyProxy(url, '')).toBe(url);
    expect(applyProxy(url, 'https://ghfast.top/')).toBe(`https://ghfast.top/${url}`);
  });

  it('在解压目录里递归找到 llama-server', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-rt-'));
    const bin = path.join(dir, 'llama-b1', 'build', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    expect(findServerBinary(dir)).toBe(bin);
    expect(findServerBinary(path.join(dir, 'nope'))).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('server', () => {
  it('拼 llama-server 参数：关闭思考模式时加 --reasoning-budget 0', () => {
    const args = buildServerArgs({ bin: '/x/llama-server', modelPath: '/m/a.gguf', alias: 'a', port: 18080, ctxSize: 32768, thinking: false, threads: null, gpuLayers: null, temperature: null, extraArgs: '' });
    expect(args).toEqual(['-m', '/m/a.gguf', '-a', 'a', '--host', '127.0.0.1', '--port', '18080', '-c', '32768', '--jinja', '--no-webui', '-ngl', '99', '--reasoning-budget', '0']);
  });

  it('思考模式、线程、温度与额外参数', () => {
    const args = buildServerArgs({ bin: '', modelPath: 'm', alias: 'a', port: 1, ctxSize: 8192, thinking: true, threads: 6, gpuLayers: 0, temperature: 0.3, extraArgs: '-fa on --name "a b"' });
    expect(args).not.toContain('--reasoning-budget');
    expect(args).toEqual(expect.arrayContaining(['-t', '6', '-ngl', '0', '--temp', '0.3', '-fa', 'on', '--name', 'a b']));
  });

  it('splitArgs 支持引号', () => {
    expect(splitArgs(`--a 1 --b "x y" 'z w'`)).toEqual(['--a', '1', '--b', 'x y', 'z w']);
    expect(splitArgs('')).toEqual([]);
  });

  it('端口被占用时顺延', async () => {
    const srv = http.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const busy = (srv.address() as any).port as number;
    const port = await findFreePort(busy);
    expect(port).toBeGreaterThan(busy);
    srv.close();
  });
});

describe('normalizeLocalConfig', () => {
  it('缺字段用默认值，非法值被纠正', () => {
    expect(normalizeLocalConfig(undefined)).toEqual(DEFAULT_LOCAL_CONFIG);
    const c = normalizeLocalConfig({ port: '99999', ctxSize: 'abc', threads: '4', source: 'bogus', customModels: [{ id: 'custom:1', path: '/a/b.gguf' }, { nope: true }] });
    expect(c.port).toBe(65535);
    expect(c.ctxSize).toBe(DEFAULT_LOCAL_CONFIG.ctxSize);
    expect(c.threads).toBe(4);
    expect(c.source).toBe('hf-mirror');
    expect(c.customModels).toEqual([{ id: 'custom:1', name: 'b.gguf', path: '/a/b.gguf', size: 0 }]);
  });
});

/**
 * 「AI 请求发往哪里」在主进程与渲染进程各判断一次（渲染进程引不了 Node 模块）。
 * 两份答案必须一样：状态栏按渲染进程那份显示，请求按主进程这份路由 —— 不一致就等于骗用户。
 * 曾经真的漂过：地址框里只剩空格时，一边算「云端」、一边算「本机模型」。
 */
describe('inferServiceType：主进程与渲染进程必须给出同样的答案', () => {
  const CASES: { config: any; expect: 'builtin' | 'local' | 'cloud'; why: string }[] = [
    { config: null, expect: 'builtin', why: '全新安装：什么都没有' },
    { config: {}, expect: 'builtin', why: '全新安装：空配置' },
    { config: { endpoint: '' }, expect: 'builtin', why: '没填过地址' },
    { config: { endpoint: '   ' }, expect: 'builtin', why: '地址框里只剩空格，等同没填' },
    { config: { endpoint: '\n\t ' }, expect: 'builtin', why: '各种空白字符同理' },

    { config: { serviceType: 'builtin' }, expect: 'builtin', why: '显式字段优先' },
    { config: { serviceType: 'local', endpoint: 'https://api.openai.com/v1' }, expect: 'local', why: '显式字段压过地址' },
    { config: { serviceType: 'cloud', endpoint: 'http://localhost:11434/v1' }, expect: 'cloud', why: '显式字段压过地址' },

    // 这两条特意让「地址推断」会给出不同答案，才能真正钉住 relay 分支本身
    { config: { serviceType: 'relay' }, expect: 'cloud', why: '26.1 的企业中转站并入网络模型服务（没地址也不能退回本机模型）' },
    { config: { serviceType: 'relay', endpoint: 'http://localhost:11434/v1' }, expect: 'cloud', why: '老的中转站配置指向本机地址，仍算网络模型服务' },
    { config: { serviceType: 'bogus', endpoint: 'http://127.0.0.1:8080/v1' }, expect: 'local', why: '认不出的取值退回按地址推断' },

    { config: { endpoint: 'http://localhost:11434/v1' }, expect: 'local', why: 'Ollama' },
    { config: { endpoint: 'http://127.0.0.1:18080/v1' }, expect: 'local', why: '本机 llama-server' },
    { config: { endpoint: 'http://[::1]:1234/v1' }, expect: 'local', why: 'IPv6 回环' },
    { config: { endpoint: 'http://0.0.0.0:8080' }, expect: 'local', why: '通配地址也算本机' },
    { config: { endpoint: ' https://api.openai.com/v1 ' }, expect: 'cloud', why: '两端空格不影响判断' },
    { config: { endpoint: 'https://api.agnes-ai.cn/v1' }, expect: 'cloud', why: 'Agnes 国内站' },
    { config: { endpoint: 'https://relay.example.com/v1' }, expect: 'cloud', why: '自定义中转地址' },
    // localhost.evil.com 不是本机：正则要求主机名后面紧跟 : / 或结尾
    { config: { endpoint: 'https://localhost.evil.com/v1' }, expect: 'cloud', why: '前缀像本机但不是本机' },
  ];

  for (const c of CASES) {
    it(`${c.why} → ${c.expect}`, () => {
      expect(inferServiceType(c.config)).toBe(c.expect);
      expect(inferInRenderer(c.config)).toBe(c.expect);
    });
  }
});

describe('download', () => {
  // 一个支持 Range 的迷你文件服务器，用来验证断点续传与校验
  const payload = Buffer.concat([Buffer.from('GGUF'), crypto.randomBytes(300 * 1024)]);
  const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
  let server: http.Server;
  let base = '';
  let tmp = '';
  let dropAfter = Infinity; // 发送多少字节后强行断开，模拟断网
  let slow = false; // 慢速滴灌，用来测试中途取消

  const start = () => new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { Location: '/file.gguf' }); return res.end(); }
      if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>login</html>'); }
      if (req.url === '/missing') { res.writeHead(404); return res.end('nope'); }
      const range = /bytes=(\d+)-/.exec(req.headers.range || '');
      const from = range ? Number(range[1]) : 0;
      if (from >= payload.length) { res.writeHead(416, { 'Content-Range': `bytes */${payload.length}` }); return res.end(); }
      const body = payload.subarray(from);
      if (range) res.writeHead(206, { 'Content-Range': `bytes ${from}-${payload.length - 1}/${payload.length}`, 'Content-Length': body.length });
      else res.writeHead(200, { 'Content-Length': body.length });
      const cut = Math.min(body.length, dropAfter);
      if (slow) {
        // 每 40ms 发 16KB，让客户端有机会在中途取消
        let offset = 0;
        const tick = () => {
          if (res.destroyed) return;
          const end = Math.min(offset + 16 * 1024, cut);
          res.write(body.subarray(offset, end));
          offset = end;
          if (offset >= cut) { if (cut < body.length) res.destroy(); else res.end(); return; }
          setTimeout(tick, 40);
        };
        tick();
        return;
      }
      // 等数据真正刷到 socket 后再断开，否则客户端连响应头都收不到
      res.write(body.subarray(0, cut), () => {
        if (cut < body.length) setTimeout(() => res.destroy(), 20);
        else res.end();
      });
    }).listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(server.address() as any).port}`; resolve(); });
  });

  afterEach(() => { server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); dropAfter = Infinity; slow = false; });

  it('断开后再次调用从断点续传，最终大小 / 头 / SHA256 都通过', async () => {
    await start();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-dl-'));
    const dest = path.join(tmp, 'file.gguf');
    dropAfter = 100 * 1024;
    await expect(downloadFile(`${base}/redirect`, dest, { expectedSize: payload.length })).rejects.toMatchObject({ code: 'network' });
    expect(fs.statSync(`${dest}.part`).size).toBe(100 * 1024);

    dropAfter = Infinity;
    const phases: string[] = [];
    await downloadFile(`${base}/redirect`, dest, { expectedSize: payload.length, sha256, checkGguf: true, onProgress: (p) => phases.push(p.phase) });
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(fs.readFileSync(dest).equals(payload)).toBe(true);
    expect(phases).toContain('verifying');
  });

  it('取消下载保留 .part，错误码为 aborted', async () => {
    await start();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-dl-'));
    const dest = path.join(tmp, 'file.gguf');
    slow = true;
    const controller = new AbortController();
    const p = downloadFile(`${base}/file.gguf`, dest, { expectedSize: payload.length, signal: controller.signal, onProgress: () => controller.abort() });
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    const partial = fs.statSync(`${dest}.part`).size;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(payload.length);
  });

  it('SHA256 不符时删除文件', async () => {
    await start();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-dl-'));
    const dest = path.join(tmp, 'file.gguf');
    await expect(downloadFile(`${base}/file.gguf`, dest, { sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'hash' });
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('镜像站返回网页时判定为格式错误', async () => {
    await start();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-dl-'));
    const dest = path.join(tmp, 'file.gguf');
    await expect(downloadFile(`${base}/html`, dest, { checkGguf: true })).rejects.toBeInstanceOf(DownloadError);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('HTTP 错误码', async () => {
    await start();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-dl-'));
    await expect(downloadFile(`${base}/missing`, path.join(tmp, 'x'), {})).rejects.toMatchObject({ code: 'http' });
  });
});
