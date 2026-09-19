/**
 * 收音设备：列出麦克风、记住用户选的那一个。
 * 选择只存在这台电脑的 localStorage 里 —— 设备 ID 是每台机器各自的，跟着笔记库或设置同步走没有意义。
 */

export interface MicOption { id: string; label: string }

export interface MicList {
  /** 系统当前的默认输入设备叫什么（没授权时读不到名字，为空） */
  systemDefault: string;
  mics: MicOption[];
  /** 没授权麦克风之前，浏览器只告诉你「有几个设备」，不给名字 */
  labelsAvailable: boolean;
}

const PREF_KEY = 'iml.micDeviceId';

/** 空串 = 跟随系统 */
export function getPreferredMic(): string {
  try { return localStorage.getItem(PREF_KEY) || ''; } catch { return ''; }
}

export function setPreferredMic(id: string) {
  try { if (id) localStorage.setItem(PREF_KEY, id); else localStorage.removeItem(PREF_KEY); } catch { /* 隐私模式下存不了就算了 */ }
}

/** 「Default - MacBook Pro Microphone (Built-in)」→「MacBook Pro Microphone」；USB 设备尾巴上的 (046d:0825) 也去掉 */
export function cleanMicLabel(label: string): string {
  return label
    .replace(/^(?:Default|Communications|默认|通信)\s*[-–—]\s*/i, '')
    .replace(/\s*\((?:Built-in|内建|内置|[0-9a-f]{4}:[0-9a-f]{4})\)\s*$/i, '')
    .trim();
}

type DeviceLike = Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>;

export function describeMics(devices: DeviceLike[]): MicList {
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  // default / communications 是 Chromium 给的「别名」，指向下面某个真实设备，不当成单独的一项
  const real = inputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const alias = inputs.find((d) => d.deviceId === 'default');
  const labelsAvailable = inputs.some((d) => !!d.label);
  return {
    systemDefault: cleanMicLabel(alias?.label || (real.length === 1 ? real[0].label : '')),
    mics: real.map((d, i) => ({ id: d.deviceId, label: cleanMicLabel(d.label) || `麦克风 ${i + 1}` })),
    labelsAvailable,
  };
}

export async function listMics(): Promise<MicList> {
  try { return describeMics(await navigator.mediaDevices.enumerateDevices()); } catch { return { systemDefault: '', mics: [], labelsAvailable: false }; }
}

/** 用户选的那个还在不在：拔掉了就退回跟随系统（但不清掉他的选择，插回来还用它） */
export function resolveMic(preferred: string, list: MicList): { deviceId: string; missing: boolean } {
  if (!preferred) return { deviceId: '', missing: false };
  return list.mics.some((m) => m.id === preferred) ? { deviceId: preferred, missing: false } : { deviceId: '', missing: true };
}

/** 面板上显示的「现在用的是哪个麦克风」 */
export function currentMicLabel(preferred: string, list: MicList): string {
  const chosen = list.mics.find((m) => m.id === preferred);
  if (chosen) return chosen.label;
  return list.systemDefault || (list.labelsAvailable ? '系统默认麦克风' : '');
}
