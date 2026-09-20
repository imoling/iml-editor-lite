/**
 * 常见同步盘在本机的目录。纯函数：只负责「可能在哪、叫什么」，存不存在由主进程去看。
 * 我们不做同步引擎——笔记库就是个文件夹，放进同步盘的目录里，同步交给同步盘自己。
 */
export interface SyncFolderCandidate {
  /** 同一家同步盘的几个候选位置用同一个 id，界面上只显示先找到的那个 */
  id: string;
  name: string;
  /** 相对用户主目录的路径 */
  rel: string[];
}

export function syncFolderCandidates(platform: string): SyncFolderCandidate[] {
  const mac = platform === 'darwin';
  return [
    { id: 'icloud', name: 'iCloud Drive', rel: mac ? ['Library', 'Mobile Documents', 'com~apple~CloudDocs'] : ['iCloudDrive'] },
    // 坚果云：不同版本的客户端默认目录名不一样，挨个试
    { id: 'nutstore', name: '坚果云', rel: ['Nutstore Files', '我的坚果云'] },
    { id: 'nutstore', name: '坚果云', rel: ['Nutstore Files'] },
    { id: 'nutstore', name: '坚果云', rel: ['Nutstore', '1', '我的坚果云'] },
    { id: 'nutstore', name: '坚果云', rel: ['坚果云'] },
    { id: 'onedrive', name: 'OneDrive', rel: ['OneDrive'] },
    { id: 'dropbox', name: 'Dropbox', rel: ['Dropbox'] },
    { id: 'baidu', name: '百度网盘同步空间', rel: ['BaiduSyncdisk'] },
    { id: 'googledrive', name: 'Google Drive', rel: ['Google Drive'] },
  ];
}

const CLOUD_STORAGE_NAMES: [RegExp, string, string][] = [
  [/^OneDrive/i, 'onedrive', 'OneDrive'],
  [/^Dropbox/i, 'dropbox', 'Dropbox'],
  [/^GoogleDrive/i, 'googledrive', 'Google Drive'],
  [/^(Nutstore|坚果云)/i, 'nutstore', '坚果云'],
  [/^Box/i, 'box', 'Box'],
  [/^(Baidu|百度)/i, 'baidu', '百度网盘'],
];

/**
 * macOS 新式同步盘统一挂在 ~/Library/CloudStorage/ 下，目录名是「服务名-账号」（OneDrive-Personal、GoogleDrive-a@b.com）。
 * 认得的给个好看的名字；不认得的直接用「-」前面那段，账号写在括号里。
 */
export function labelCloudStorageDir(dirName: string): { id: string; name: string } {
  const [service, ...account] = dirName.split('-');
  const known = CLOUD_STORAGE_NAMES.find(([re]) => re.test(dirName));
  const suffix = account.length ? `（${account.join('-')}）` : '';
  return known ? { id: known[1], name: known[2] + (account.length && known[1] !== 'dropbox' ? suffix : '') } : { id: `cloud:${dirName}`, name: service + suffix };
}

export const SYNC_LIBRARY_NAME = 'iML Notes';

/**
 * 从同步盘「改回原来的目录」时回到哪：先是放进去之前记下的那个目录，其次是应用默认的笔记库目录；
 * 都不在了（被删、改名、换机器）就返回 null，界面上退回到让用户自己选。
 */
export function libraryToReturnTo(candidates: { path: string; exists: boolean }[]): string | null {
  return candidates.find((c) => c.path && c.exists)?.path ?? null;
}
