import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NoteHistory, pruneEntries, COALESCE_MS, type HistoryEntry } from './history';

let dir: string;
let history: NoteHistory;
let note: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iml-history-'));
  history = new NoteHistory(path.join(dir, 'store'));
  note = path.join(dir, 'lib', '笔记.md');
  fs.mkdirSync(path.dirname(note), { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('NoteHistory', () => {
  it('覆盖写入前，磁盘上没留过底的内容先存一份（别的编辑器写的版本不会被一次保存抹掉）', async () => {
    fs.writeFileSync(note, '外部编辑器写的内容');
    await history.beforeOverwrite(note, '在应用里改过的内容');
    await history.record(note, '在应用里改过的内容', 'save');
    const list = await history.list(note);
    expect(list.map((e) => e.reason)).toEqual(['save', 'before-save']);
    expect(await history.read(note, list[1].id)).toBe('外部编辑器写的内容');
    expect(await history.read(note, list[0].id)).toBe('在应用里改过的内容');
  });

  it('内容没变不重复记；已经留过底的旧内容不再重复留底', async () => {
    await history.record(note, 'v1', 'save');
    expect(await history.record(note, 'v1', 'save')).toBeNull();
    fs.writeFileSync(note, 'v1');
    await history.beforeOverwrite(note, 'v2');
    expect(await history.list(note)).toHaveLength(1);
  });

  it('时间窗内的连续保存合并成一个版本，但最早的基线保留', async () => {
    const t0 = Date.now() - 60_000;
    await history.record(note, '基线', 'save', t0);
    await history.record(note, '改动 1', 'save', t0 + 1000);
    await history.record(note, '改动 2', 'save', t0 + 2000);
    await history.record(note, '改动 3', 'save', t0 + 3000);
    const list = await history.list(note);
    expect(list).toHaveLength(2);
    expect(await history.read(note, list[0].id)).toBe('改动 3');
    expect(await history.read(note, list[1].id)).toBe('基线');
    // 过了时间窗就是新版本
    await history.record(note, '第二天', 'save', t0 + 3000 + COALESCE_MS + 1);
    expect(await history.list(note)).toHaveLength(3);
  });

  it('很久没动过的旧笔记：留底版本显示原来的修改时间，但不会因为「太老」被立刻清掉', async () => {
    fs.writeFileSync(note, '一年前写的');
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    fs.utimesSync(note, yearAgo, yearAgo);
    await history.beforeOverwrite(note, '今天改的');
    await history.record(note, '今天改的', 'save');
    const list = await history.list(note);
    expect(list).toHaveLength(2);
    expect(list[1].reason).toBe('before-save');
    expect(Math.abs(list[1].time - yearAgo.getTime())).toBeLessThan(2000);
    expect(await history.read(note, list[1].id)).toBe('一年前写的');
  });

  it('空内容、非笔记文件、非法 id 都不处理', async () => {
    expect(await history.record(note, '', 'save')).toBeNull();
    expect(await history.record(path.join(dir, 'a.png'), 'x', 'save')).toBeNull();
    expect(await history.read(note, '../../etc/passwd')).toBeNull();
  });

  it('应用内重命名文件或文件夹，历史跟着走', async () => {
    await history.record(note, '内容', 'save');
    const renamed = path.join(dir, 'lib', '新名字.md');
    await history.rename(note, renamed);
    expect(await history.list(note)).toHaveLength(0);
    expect(await history.list(renamed)).toHaveLength(1);

    await history.rename(path.join(dir, 'lib'), path.join(dir, 'library'));
    expect(await history.list(path.join(dir, 'library', '新名字.md'))).toHaveLength(1);
  });
});

describe('pruneEntries', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 8, 18, 12);
  const entry = (time: number): HistoryEntry => ({ id: String(time), time, recordedAt: time, size: 1, hash: String(time), reason: 'save' });

  it('24 小时内全留；更早的每天只留最后一个；超过 60 天的丢掉', () => {
    const recent = [now - 1000, now - 2000, now - 3000].map(entry);
    const threeDaysAgo = [now - 3 * DAY, now - 3 * DAY - 1000, now - 3 * DAY - 2000].map(entry);
    const ancient = [entry(now - 61 * DAY)];
    const { keep, drop } = pruneEntries([...recent, ...threeDaysAgo, ...ancient], now);
    expect(keep.map((e) => e.time)).toEqual([now - 3 * DAY, now - 3000, now - 2000, now - 1000]);
    expect(drop).toHaveLength(3);
  });
});
