import { describe, expect, it } from 'vitest';
import { pickInstaller, describeRelease, platformLabel } from './update';

const asset = (name: string, size = 1) => ({ name, browser_download_url: `https://github.com/imoling/iml-markdown-editor/releases/download/v1/${name}`, size });

// 26.2.0 实际发布的文件：Windows 只有一个不分架构的安装包
const V262 = [asset('iML.Markdown.Editor-26.2.0-arm64.dmg'), asset('iML.Markdown.Editor-26.2.0-x64.dmg'), asset('iML.Markdown.Editor.Setup.26.2.0.exe')];
// 26.3 起 Windows 每种架构单独出包
const V263 = [asset('iML.Markdown.Editor-26.3.0-arm64.dmg'), asset('iML.Markdown.Editor-26.3.0-x64.dmg'), asset('iML.Markdown.Editor-Setup-26.3.0-x64.exe'), asset('iML.Markdown.Editor-Setup-26.3.0-arm64.exe'), asset('iML.Markdown.Editor-Setup-26.3.0-x64.exe.blockmap')];

describe('检查更新：挑出这台电脑该下的安装包', () => {
  it('架构对得上的优先', () => {
    expect(pickInstaller(V263, 'darwin', 'arm64')?.name).toBe('iML.Markdown.Editor-26.3.0-arm64.dmg');
    expect(pickInstaller(V263, 'darwin', 'x64')?.name).toBe('iML.Markdown.Editor-26.3.0-x64.dmg');
    expect(pickInstaller(V263, 'win32', 'x64')?.name).toBe('iML.Markdown.Editor-Setup-26.3.0-x64.exe');
    expect(pickInstaller(V263, 'win32', 'arm64')?.name).toBe('iML.Markdown.Editor-Setup-26.3.0-arm64.exe');
  });

  it('旧版不分架构的 Windows 安装包照样认；.blockmap 不是安装包', () => {
    expect(pickInstaller(V262, 'win32', 'x64')?.name).toBe('iML.Markdown.Editor.Setup.26.2.0.exe');
    expect(pickInstaller(V262, 'win32', 'arm64')?.name).toBe('iML.Markdown.Editor.Setup.26.2.0.exe');
    expect(pickInstaller([asset('a-x64.exe.blockmap')], 'win32', 'x64')).toBeNull();
  });

  it('ARM 的机器可以退到 x64 的包；x64 的机器不能给 ARM 的包；别的平台没有安装包', () => {
    const onlyX64 = [asset('app-1.0-x64.dmg'), asset('app-Setup-1.0-x64.exe')];
    const onlyArm = [asset('app-1.0-arm64.dmg'), asset('app-Setup-1.0-arm64.exe')];
    expect(pickInstaller(onlyX64, 'darwin', 'arm64')?.name).toBe('app-1.0-x64.dmg');
    expect(pickInstaller(onlyX64, 'win32', 'arm64')?.name).toBe('app-Setup-1.0-x64.exe');
    expect(pickInstaller(onlyArm, 'darwin', 'x64')).toBeNull();
    expect(pickInstaller(onlyArm, 'win32', 'x64')).toBeNull();
    expect(pickInstaller(V263, 'linux', 'x64')).toBeNull();
  });

  it('GitHub 的响应 → 界面用的信息；响应缺胳膊少腿也不炸', () => {
    const info = describeRelease({ tag_name: 'v26.3.0', html_url: 'https://github.com/x/releases/tag/v26.3.0', body: '## 26.3.0 — 标题', assets: [...V263.map((a) => ({ ...a, size: 82_000_000 })), { name: 1 }] }, 'darwin', 'arm64');
    expect(info).toMatchObject({ success: true, latestVersion: '26.3.0', notes: '## 26.3.0 — 标题' });
    expect(info.download).toMatchObject({ name: 'iML.Markdown.Editor-26.3.0-arm64.dmg', size: 82_000_000, label: 'macOS（Apple 芯片）' });
    expect(describeRelease({ tag_name: 'v1.0.0' }, 'win32', 'x64')).toMatchObject({ success: true, latestVersion: '1.0.0', notes: '', download: undefined });
    expect(platformLabel('win32', 'x64')).toBe('Windows');
  });
});
