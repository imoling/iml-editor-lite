import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * 安装包的守卫：体积、应用标识、权限。换成 Tauri 壳之后 macOS 的安装包不到 4 MB，下面这几条防止它悄悄胖回去，
 * 也防止「iML 笔记」那边的东西（录音权限、链接协议）漏过来。
 */
const root = path.join(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const conf = (name: string) => JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', name), 'utf8'));

describe('安装包', () => {
  it('和「iML 笔记」装在同一台电脑上互不干扰：应用标识不同；版本号只有 package.json 一处', () => {
    const base = conf('tauri.conf.json');
    expect(base.identifier).toBe('com.imoling.editor');
    expect(base.version).toBe('../package.json');
    const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
    expect(/^version = "([^"]+)"/m.exec(cargo)?.[1]).toBe(pkg.version);
  });

  it('三个平台的窗口都关掉系统的拖放接管', () => {
    // 系统 WebView 默认自己接管文件拖放，页面收不到 drop 事件——往编辑器里拖图片就没反应了。
    // 平台配置是整段覆盖 windows 数组的，每一份都得写
    for (const name of ['tauri.conf.json', 'tauri.macos.conf.json', 'tauri.windows.conf.json']) {
      for (const win of conf(name).app.windows) expect(win.dragDropEnabled).toBe(false);
    }
  });

  it('轻量版不登记链接协议，不申请设备权限；安装包的文件名是英文、带 Lite 和架构', () => {
    // 这个版本没有录音、没有 iml:// 唤起：多出来说明有东西从主版本漏过来了
    const base = conf('tauri.conf.json');
    expect(base.plugins?.['deep-link']).toBeUndefined();
    expect(base.bundle.macOS.entitlements).toBeUndefined();
    expect(base.bundle.macOS.infoPlist).toBeUndefined();
    // GitHub Release 的附件名里放不了中文，检查更新又靠文件名里的架构挑安装包
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    expect(workflow).toContain('release/iML-Editor-Lite-${VERSION}-${{ matrix.arch }}.dmg');
    expect(workflow).toContain('release/iML-Editor-Lite-Setup-${VERSION}-${{ matrix.arch }}.exe');
  });

  it('轻量：KaTeX 只带 woff2；macOS 的包做本地签名（否则 Apple 芯片上下载下来报「已损坏」）', () => {
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    expect(vite).toMatch(/plugins: \[react\(\), dropLegacyKatexFonts\]/);
    const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    expect(conf.bundle.macOS.signingIdentity).toBe('-');
    // Rust 这边的发布配置：按体积优化、整体链接优化、去掉符号
    const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
    for (const line of ['opt-level = "s"', 'lto = true', 'strip = true', 'panic = "abort"']) expect(cargo).toContain(line);
  });

  it('轻量：同一份东西不带两遍——公式字体不内联进 JS（包里已有 woff2）；macOS 图标不带 1024 那一层', () => {
    // 字体：导出时才从包里读（?url），写回 ?inline 的话安装包里会多出二十个 base64 的 JS 块，约 260 KB
    const source = fs.readFileSync(path.join(root, 'src/utils/exportImage.ts'), 'utf8');
    expect(source).toMatch(/katex\/dist\/fonts\/\*\.woff2', \{ query: '\?url'/);
    expect(source).not.toMatch(/woff2', \{ query: '\?inline'/);
    // 图标：重新跑过 `npx tauri icon` 之后要再跑一次 scripts/trim-icns.mjs
    const icns = fs.readFileSync(path.join(root, 'src-tauri/icons/icon.icns'));
    const types: string[] = [];
    for (let at = 8; at + 8 <= icns.length; at += icns.readUInt32BE(at + 4)) types.push(icns.toString('latin1', at, at + 4));
    expect(types).toContain('ic09'); // 512 的那层得在
    expect(types).not.toContain('ic10');
    expect(icns.length).toBeLessThan(260 * 1024);
  });
});
