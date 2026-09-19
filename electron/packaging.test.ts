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
});
