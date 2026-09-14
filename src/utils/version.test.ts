import { describe, expect, it } from 'vitest';
import { formatVersion, isNewerVersion } from './version';

describe('version', () => {
  it('隐藏末尾的 .0，保留补丁号', () => {
    expect(formatVersion('26.1.0')).toBe('26.1');
    expect(formatVersion('26.1.2')).toBe('26.1.2');
    expect(formatVersion('')).toBe('');
    expect(formatVersion(undefined)).toBe('');
  });

  it('逐段比较，旧的 GitHub 发布不会被当成新版本', () => {
    expect(isNewerVersion('1.9.0', '26.1.0')).toBe(false);
    expect(isNewerVersion('v26.2.0', '26.1.0')).toBe(true);
    expect(isNewerVersion('26.1.1', '26.1.0')).toBe(true);
    expect(isNewerVersion('26.1.0', '26.1.0')).toBe(false);
    expect(isNewerVersion('26.10.0', '26.9.0')).toBe(true);
    expect(isNewerVersion(undefined, '26.1.0')).toBe(false);
  });
});
