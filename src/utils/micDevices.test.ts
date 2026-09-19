import { describe, it, expect, beforeEach } from 'vitest';
import { describeMics, cleanMicLabel, resolveMic, currentMicLabel, getPreferredMic, setPreferredMic } from './micDevices';

const dev = (deviceId: string, label: string, kind: MediaDeviceKind = 'audioinput') => ({ deviceId, label, kind });

describe('收音设备', () => {
  beforeEach(() => localStorage.clear());

  it('设备名去掉 Chromium 加的前后缀', () => {
    expect(cleanMicLabel('Default - MacBook Pro Microphone (Built-in)')).toBe('MacBook Pro Microphone');
    expect(cleanMicLabel('默认 - 外置麦克风 (内建)')).toBe('外置麦克风');
    expect(cleanMicLabel('Logitech Webcam C270 (046d:0825)')).toBe('Logitech Webcam C270');
    expect(cleanMicLabel('AirPods Pro')).toBe('AirPods Pro');
  });

  it('default / communications 是别名，不单列；从别名读出系统当前用的是哪个', () => {
    const list = describeMics([
      dev('default', 'Default - AirPods Pro'), dev('communications', 'Communications - AirPods Pro'),
      dev('a1', 'MacBook Pro Microphone (Built-in)'), dev('b2', 'AirPods Pro'),
      dev('x', 'MacBook Pro Speakers', 'audiooutput'),
    ]);
    expect(list.systemDefault).toBe('AirPods Pro');
    expect(list.mics).toEqual([{ id: 'a1', label: 'MacBook Pro Microphone' }, { id: 'b2', label: 'AirPods Pro' }]);
    expect(list.labelsAvailable).toBe(true);
  });

  it('没授权之前读不到名字：给个占位的名字，并标明名字不可用', () => {
    const list = describeMics([dev('', ''), dev('a1', '')]);
    expect(list.labelsAvailable).toBe(false);
    expect(list.mics).toEqual([{ id: 'a1', label: '麦克风 1' }]);
    expect(currentMicLabel('', list)).toBe('');
  });

  it('选的那个拔掉了就暂时跟随系统，但不忘掉用户的选择', () => {
    const list = describeMics([dev('default', 'Default - MacBook Pro Microphone'), dev('a1', 'MacBook Pro Microphone')]);
    setPreferredMic('usb-9');
    expect(resolveMic(getPreferredMic(), list)).toEqual({ deviceId: '', missing: true });
    expect(currentMicLabel('usb-9', list)).toBe('MacBook Pro Microphone');
    expect(getPreferredMic()).toBe('usb-9');
    expect(resolveMic('a1', list)).toEqual({ deviceId: 'a1', missing: false });
    setPreferredMic('');
    expect(getPreferredMic()).toBe('');
    expect(resolveMic('', list)).toEqual({ deviceId: '', missing: false });
  });
});
