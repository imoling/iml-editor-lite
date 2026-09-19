/**
 * 检查更新：从 GitHub 的 Release 里挑出「这台电脑该下哪个安装包」。
 * 应用没有签名，做不了应用内自动更新；能做到的是把人直接送到对的那个文件，而不是扔到一个要自己挑的页面。
 */

export interface ReleaseAsset { name: string; browser_download_url: string; size: number }

export interface UpdateInfo {
  success: boolean;
  latestVersion?: string;
  releaseUrl?: string;
  /** Release 说明的 Markdown 原文（界面上只摘要点） */
  notes?: string;
  /** 这台电脑对应的安装包；挑不出来就没有，界面退回到打开 Release 页面 */
  download?: { url: string; name: string; size: number; label: string };
  error?: string;
}

const archOf = (name: string): 'arm64' | 'x64' | null => (/arm64|aarch64/i.test(name) ? 'arm64' : /x64|x86_64|amd64/i.test(name) ? 'x64' : null);

/** 给人看的平台名 */
export function platformLabel(platform: string, arch: string): string {
  if (platform === 'darwin') return arch === 'arm64' ? 'macOS（Apple 芯片）' : 'macOS（Intel）';
  if (platform === 'win32') return arch === 'arm64' ? 'Windows（ARM）' : 'Windows';
  return platform;
}

/**
 * 优先架构完全对得上的；其次是不分架构的（26.2 及以前 Windows 只有一个通用安装包）；
 * ARM 的机器能跑 x64 的包（Rosetta / Windows 的模拟层），反过来不行 —— 宁可不给，也不能给一个装不上的
 */
export function pickInstaller(assets: ReleaseAsset[], platform: string, arch: string): ReleaseAsset | null {
  const ext = platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : null;
  if (!ext) return null;
  const candidates = assets.filter((a) => a.name.toLowerCase().endsWith(ext));
  const want = arch === 'arm64' ? 'arm64' : 'x64';
  return candidates.find((a) => archOf(a.name) === want)
    ?? candidates.find((a) => archOf(a.name) === null)
    ?? (want === 'arm64' ? candidates.find((a) => archOf(a.name) === 'x64') : undefined)
    ?? null;
}

/** GitHub releases/latest 的响应 → 界面要用的信息 */
export function describeRelease(data: any, platform: string, arch: string): UpdateInfo {
  const assets: ReleaseAsset[] = Array.isArray(data?.assets)
    ? data.assets.filter((a: any) => typeof a?.name === 'string' && typeof a?.browser_download_url === 'string').map((a: any) => ({ name: a.name, browser_download_url: a.browser_download_url, size: Number(a.size) || 0 }))
    : [];
  const installer = pickInstaller(assets, platform, arch);
  return {
    success: true,
    latestVersion: String(data?.tag_name || '').replace(/^v/, ''),
    releaseUrl: data?.html_url,
    notes: typeof data?.body === 'string' ? data.body : '',
    download: installer ? { url: installer.browser_download_url, name: installer.name, size: installer.size, label: platformLabel(platform, arch) } : undefined,
  };
}
