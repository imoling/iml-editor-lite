import os from 'os';
import { execFile } from 'child_process';
import type { LocalModelSpec } from './catalog';

export interface DeviceInfo {
  platform: NodeJS.Platform;
  osName: string;
  osVersion: string;
  arch: string;
  chip: string;
  totalMemBytes: number;
  cores: number;
  accel: 'metal' | 'cpu';
  accelLabel: string;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
    } catch {
      resolve('');
    }
  });
}

/** 本机硬件概况：芯片、内存、核心数与推理加速方式 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const platform = process.platform;
  const arch = process.arch;
  let chip = os.cpus()[0]?.model?.trim() || '未知处理器';
  let osVersion = os.release();
  const osName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform;

  if (platform === 'darwin') {
    const [brand, ver] = await Promise.all([run('sysctl', ['-n', 'machdep.cpu.brand_string']), run('sw_vers', ['-productVersion'])]);
    if (brand) chip = brand;
    if (ver) osVersion = ver;
  }

  // llama.cpp 的 macOS arm64 发布包带 Metal 后端；其他平台的通用包走 CPU
  const accel: DeviceInfo['accel'] = platform === 'darwin' && arch === 'arm64' ? 'metal' : 'cpu';
  return {
    platform,
    osName,
    osVersion,
    arch,
    chip,
    totalMemBytes: os.totalmem(),
    cores: os.cpus().length,
    accel,
    accelLabel: accel === 'metal' ? 'Metal 加速' : '仅 CPU 推理',
  };
}

export interface RequirementCheck {
  level: 'ok' | 'warn' | 'fail';
  message: string;
}

/**
 * 粗略判断本机能否跑某个模型：按建议内存 / 核心数给出「满足 / 偏紧 / 不足」。
 * 偏紧的判定：内存至少是模型文件的 1.5 倍再加 2GB 的系统余量。
 */
export function checkRequirement(info: Pick<DeviceInfo, 'totalMemBytes' | 'cores'>, spec: Pick<LocalModelSpec, 'size' | 'minRamGB' | 'minCores'>): RequirementCheck {
  const ramGB = info.totalMemBytes / 1024 ** 3;
  const ramLabel = `${Math.round(ramGB)}GB`;
  if (ramGB + 0.5 >= spec.minRamGB && info.cores >= spec.minCores) {
    return { level: 'ok', message: '满足所选模型要求' };
  }
  const tight = (spec.size / 1024 ** 3) * 1.5 + 2;
  if (ramGB + 0.5 >= tight) {
    const parts: string[] = [];
    if (ramGB + 0.5 < spec.minRamGB) parts.push(`建议 ${spec.minRamGB}GB 内存，本机 ${ramLabel}`);
    if (info.cores < spec.minCores) parts.push(`建议 ${spec.minCores} 核，本机 ${info.cores} 核`);
    return { level: 'warn', message: `配置偏紧：${parts.join('；')}，可以运行但会慢一些` };
  }
  return { level: 'fail', message: `内存不足：该模型建议 ${spec.minRamGB}GB，本机只有 ${ramLabel}，请换更小的模型` };
}
