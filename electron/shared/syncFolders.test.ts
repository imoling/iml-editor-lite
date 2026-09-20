import { describe, expect, it } from 'vitest';
import { syncFolderCandidates, labelCloudStorageDir, libraryToReturnTo } from './syncFolders';

describe('同步盘目录', () => {
  it('iCloud Drive 在 mac 和 Windows 上位置不同；坚果云给出几个候选、用同一个 id', () => {
    expect(syncFolderCandidates('darwin').find((c) => c.id === 'icloud')!.rel).toEqual(['Library', 'Mobile Documents', 'com~apple~CloudDocs']);
    expect(syncFolderCandidates('win32').find((c) => c.id === 'icloud')!.rel).toEqual(['iCloudDrive']);
    expect(syncFolderCandidates('darwin').filter((c) => c.id === 'nutstore').length).toBeGreaterThan(1);
  });
  it('~/Library/CloudStorage 下的目录名 → 好认的名字；不认得的也能用', () => {
    expect(labelCloudStorageDir('OneDrive-Personal')).toEqual({ id: 'onedrive', name: 'OneDrive（Personal）' });
    expect(labelCloudStorageDir('GoogleDrive-me@example.com')).toEqual({ id: 'googledrive', name: 'Google Drive（me@example.com）' });
    expect(labelCloudStorageDir('Dropbox')).toEqual({ id: 'dropbox', name: 'Dropbox' });
    expect(labelCloudStorageDir('Nutstore-abc')).toMatchObject({ id: 'nutstore' });
    expect(labelCloudStorageDir('SomeCloud-work')).toEqual({ id: 'cloud:SomeCloud-work', name: 'SomeCloud（work）' });
  });
});

describe('libraryToReturnTo：移出同步盘后回到哪', () => {
  it('优先回放进去之前的目录，它没了就用默认目录，都没了返回 null', () => {
    expect(libraryToReturnTo([{ path: '/old', exists: true }, { path: '/docs/iML Notes', exists: true }])).toBe('/old');
    expect(libraryToReturnTo([{ path: '/old', exists: false }, { path: '/docs/iML Notes', exists: true }])).toBe('/docs/iML Notes');
    expect(libraryToReturnTo([{ path: '', exists: true }, { path: '/docs/iML Notes', exists: false }])).toBeNull();
  });
});
