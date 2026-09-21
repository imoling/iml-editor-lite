#!/usr/bin/env node
// `npx tauri icon` 生成的 icon.icns 里，1024 像素那一层（ic10）一张就占一半多（约 260 KB），
// 而它只在访达里把图标放到最大时才用得上——安装包总共不到 4 MB，不值得。去掉它，系统会拿 512 的那层放大。
// 用法：node scripts/trim-icns.mjs [icns 路径]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(root, 'src-tauri/icons/icon.icns'));
const DROP = new Set(['ic10']);

const source = fs.readFileSync(file);
if (source.toString('latin1', 0, 4) !== 'icns') throw new Error(`${file} 不是 icns 文件`);

const kept = [];
for (let at = 8; at + 8 <= source.length;) {
  const type = source.toString('latin1', at, at + 4);
  const size = source.readUInt32BE(at + 4);
  if (size < 8) throw new Error(`icns 里 ${type} 这一块的长度不对`);
  if (!DROP.has(type)) kept.push(source.subarray(at, at + size));
  at += size;
}

const body = Buffer.concat(kept);
const header = Buffer.alloc(8);
header.write('icns', 0, 'latin1');
header.writeUInt32BE(body.length + 8, 4);
fs.writeFileSync(file, Buffer.concat([header, body]));
console.log(`${path.relative(root, file)}: ${source.length} → ${body.length + 8} 字节`);
