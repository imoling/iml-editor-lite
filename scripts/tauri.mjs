// `npm run tauri:dev` / `tauri:build` 的入口：先确保找得到 cargo，再把参数原样交给 Tauri CLI。
//
// rustup 把 ~/.cargo/bin 写进 shell 的启动文件，但只对「之后新开」的终端生效：装 Rust 之前就开着的终端里，
// Tauri CLI 只会报一句看不懂的 `failed to run 'cargo metadata' … No such file or directory`。
// 这里自己把 rustup 的默认安装位置补进 PATH；真没装，就说人话。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
const env = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
const hasCargo = () => spawnSync(isWindows ? 'cargo.exe' : 'cargo', ['--version'], { env, stdio: 'ignore' }).status === 0;

if (!hasCargo()) {
  const cargoBin = join(env.CARGO_HOME || join(homedir(), '.cargo'), 'bin');
  if (existsSync(join(cargoBin, isWindows ? 'cargo.exe' : 'cargo'))) env[pathKey] = `${cargoBin}${delimiter}${env[pathKey] || ''}`;
  if (!hasCargo()) {
    console.error('\n找不到 cargo：Tauri 壳要用 Rust 编译。\n  · 还没装：https://rustup.rs （国内网络可用 rsproxy.cn 的镜像）\n  · 刚装完：新开一个终端，或先执行  source ~/.cargo/env\n');
    process.exit(1);
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
if (!existsSync(cli)) {
  console.error('\n找不到 Tauri CLI：先执行 npm install（从 main 分支切过来之后也要装一次，两边的依赖不一样）。\n');
  process.exit(1);
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
