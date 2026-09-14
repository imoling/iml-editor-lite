import { describe, it, expect } from 'vitest';
import { WHATS_NEW, latestWhatsNew, shouldShowWhatsNew, type WhatsNewEntry } from './whatsNew';

const entries: WhatsNewEntry[] = [
  { version: '26.2', title: '', pages: [], releaseUrl: '' },
  { version: '26.1', title: '', pages: [], releaseUrl: '' },
];

describe('whatsNew', () => {
  it('内置条目覆盖当前大版本', () => {
    expect(latestWhatsNew('26.1.0')?.version).toBe('26.1');
    expect(WHATS_NEW[0].pages.length).toBeGreaterThan(3);
    expect(new Set(WHATS_NEW[0].pages.map((p) => p.key)).size).toBe(WHATS_NEW[0].pages.length);
  });

  it('新安装（无记录）时展示', () => {
    expect(shouldShowWhatsNew('26.1.0', null, entries)).toBe(true);
    expect(shouldShowWhatsNew('26.1.0', undefined, entries)).toBe(true);
  });

  it('升级到有介绍的新版本时展示，同一大版本的小修订不重复', () => {
    expect(shouldShowWhatsNew('26.2.0', '26.1.0', entries)).toBe(true);
    expect(shouldShowWhatsNew('26.1.3', '26.1.0', entries)).toBe(false);
    expect(shouldShowWhatsNew('26.1.0', '26.1.0', entries)).toBe(false);
  });

  it('当前版本没有写介绍时不展示', () => {
    expect(shouldShowWhatsNew('27.1.0', null, entries)).toBe(false);
    expect(latestWhatsNew('27.1.0', entries)).toBeNull();
  });
});
