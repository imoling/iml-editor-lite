import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { builtinModules } from 'module';

/**
 * 安装包体积的守卫。26.2 的 Windows 安装包 250 MB、mac 153 MB，被用户说「跟轻量没关系了」，原因有两个：
 * ① package.json 的 dependencies 里放着 34 个渲染进程的库 —— 它们早就被 Vite 打进 dist/ 了，
 *    但 electron-builder 会把 dependencies 的整棵 node_modules（236 MB）再塞进 app.asar 一遍；
 * ② Windows 把 x64 和 arm64 合成了一个「通用」安装包，等于两份完整的应用。
 * 修掉之后 Windows 79 MB、mac 88 MB。下面这几条防止它悄悄胖回去。
 */
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(e.name) && !/\.(test|d)\.ts$/.test(e.name) ? [full] : [];
  });
}

describe('安装包体积', () => {
  it('dependencies 是空的：界面用的库放 devDependencies（Vite 会打进 dist），放 dependencies 会被整棵塞进安装包', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('主进程只用 Node 内置模块和 electron：要加第三方库，得同时放进 dependencies 并在这里登记，否则打包后找不到模块', () => {
    const allowed = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'electron', ...Object.keys(pkg.dependencies ?? {})]);
    const offenders: string[] = [];
    for (const file of sourceFiles(__dirname)) {
      const code = fs.readFileSync(file, 'utf8');
      for (const m of code.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('.') || allowed.has(spec) || allowed.has(spec.split('/')[0])) continue;
        offenders.push(`${path.relative(root, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('只打运行时用得到的文件；Chromium 语言包只留中英文；Windows 每种架构单独出包', () => {
    expect(pkg.build.files).not.toContain('assets/**/*');
    expect(pkg.build.files).toContain('!dist-electron/**/*.test.js');
    // mac 的语言目录叫 zh_CN.lproj / en.lproj，Windows 的叫 zh-CN.pak / en-US.pak，按文件名精确匹配，两种写法都得有
    expect(pkg.build.electronLanguages).toEqual(expect.arrayContaining(['en', 'en-US', 'zh_CN', 'zh-CN']));
    expect(pkg.build.nsis.buildUniversalInstaller).toBe(false);
    expect(pkg.build.nsis.artifactName).toContain('${arch}');
  });

  it('macOS：轻量版不申请任何设备权限，也不登记自己的链接协议；安装包的文件名是英文', () => {
    // 这个版本没有录音、没有 iml:// 唤起：权限声明里多出麦克风，或者 Info.plist 里多出用途说明，都说明有东西从主版本漏过来了
    const mac = pkg.build.mac;
    expect(mac.hardenedRuntime).toBe(true);
    expect(mac.entitlements).toBe('build/entitlements.mac.plist');
    expect(mac.entitlementsInherit).toBe(mac.entitlements);
    const plist = fs.readFileSync(path.join(root, mac.entitlements), 'utf8');
    expect(plist).not.toMatch(/com\.apple\.security\.device\./);
    expect(plist).toMatch(/<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
    expect(Object.keys(mac.extendInfo).filter((k) => /UsageDescription$/.test(k))).toEqual([]);
    expect(pkg.build.protocols).toBeUndefined();
    // GitHub Release 的附件名里放不了中文，检查更新又靠文件名里的架构挑安装包
    for (const name of [mac.artifactName, pkg.build.nsis.artifactName]) {
      expect(name).toMatch(/^[\x20-\x7e]+$/);
      expect(name).toContain('${arch}');
    }
  });

  it('和「iML 笔记」装在同一台电脑上互不干扰：应用标识不同，数据目录钉死成自己的', () => {
    expect(pkg.build.appId).toBe('com.imoling.editor');
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    expect(main).toMatch(/app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), 'iML Editor'\)\)/);
  });

  it('Tauri 壳和 Electron 壳是同一个应用：标识、版本号一致；三个平台的窗口都关掉系统的拖放接管', () => {
    const conf = (name: string) => JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', name), 'utf8'));
    const base = conf('tauri.conf.json');
    expect(base.identifier).toBe(pkg.build.appId);
    expect(base.version).toBe('../package.json');
    const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
    expect(/^version = "([^"]+)"/m.exec(cargo)?.[1]).toBe(pkg.version);
    // 系统 WebView 默认自己接管文件拖放，页面收不到 drop 事件——往编辑器里拖图片就没反应了。
    // 平台配置是整段覆盖 windows 数组的，每一份都得写
    for (const name of ['tauri.conf.json', 'tauri.macos.conf.json', 'tauri.windows.conf.json']) {
      for (const win of conf(name).app.windows) expect(win.dragDropEnabled).toBe(false);
    }
    // 两个壳认的文档类型一样
    expect(base.bundle.fileAssociations[0].ext).toEqual(pkg.build.fileAssociations[0].ext);
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
