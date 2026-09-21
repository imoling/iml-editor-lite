import { describe, expect, it, beforeEach, vi } from 'vitest';

const invoke = vi.fn();
const listen = vi.fn(async () => () => {});
const openDialog = vi.fn();
const saveDialog = vi.fn();
const tauriWindow = { setTitle: vi.fn(async () => {}), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() };

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => (listen as any)(...args) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => tauriWindow }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openDialog(...args), save: (...args: unknown[]) => saveDialog(...args) }));

import { createTauriApi } from './tauriApi';

beforeEach(() => { invoke.mockReset(); listen.mockClear(); openDialog.mockReset(); saveDialog.mockReset(); });

/** 界面只认 window.api 这一个形状：Tauri 壳的适配层要和 Electron 的 preload 给出同样的返回值 */
describe('Tauri 壳的适配层', () => {
  it('打开对话框：参数是 Electron 的写法，返回值一律是数组或 null', async () => {
    const api = createTauriApi();
    openDialog.mockResolvedValueOnce('/a.md');
    expect(await api.dialog.open({ properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] })).toEqual(['/a.md']);
    expect(openDialog).toHaveBeenLastCalledWith(expect.objectContaining({ directory: false, multiple: false }));

    openDialog.mockResolvedValueOnce(['/a.md', '/b.md']);
    expect(await api.dialog.open({ properties: ['openFile', 'multiSelections'] })).toEqual(['/a.md', '/b.md']);
    expect(openDialog).toHaveBeenLastCalledWith(expect.objectContaining({ multiple: true }));

    openDialog.mockResolvedValueOnce(null);
    expect(await api.dialog.open({ properties: ['openDirectory'] })).toBeNull();
    expect(openDialog).toHaveBeenLastCalledWith(expect.objectContaining({ directory: true }));
  });

  it('读写文件：成功与失败都是 { success, … } 的形状，不往外抛', async () => {
    const api = createTauriApi();
    invoke.mockResolvedValueOnce('正文');
    expect(await api.fs.readFile('/a.md')).toEqual({ success: true, content: '正文', filePath: '/a.md' });
    invoke.mockRejectedValueOnce('No such file or directory');
    expect(await api.fs.readFile('/gone.md')).toEqual({ success: false, error: 'No such file or directory' });
    invoke.mockResolvedValueOnce(true);
    expect(await api.fs.delete('/a.md')).toEqual({ success: true, path: '/a.md', permanently: true });
  });

  it('粘贴的图片：名字先收拾干净（剪贴板截图统一叫 image.png → 时间戳），目录和名字放在请求头里、内容走请求体', async () => {
    const api = createTauriApi();
    invoke.mockResolvedValueOnce({ path: 'assets/img-x.png', bytes: 3 });
    const result = await api.fs.saveImage('/笔记/周 会.md', 'image.png', new Uint8Array([1, 2, 3]).buffer);
    expect(result).toEqual({ success: true, path: 'assets/img-x.png', bytes: 3 });
    const [cmd, body, options] = invoke.mock.calls[0];
    expect(cmd).toBe('fs_save_asset');
    expect(Array.from(body as Uint8Array)).toEqual([1, 2, 3]);
    // 请求头只能是 ASCII：中文和空格都转义过
    expect(options.headers['x-dir']).toBe(encodeURIComponent('/笔记'));
    expect(decodeURIComponent(options.headers['x-name'])).toMatch(/^img-\d{8}-\d{6}\.png$/);
  });

  it('取网页标题：壳只管把字节拿回来，编码和标题由这边判——GBK 的页面也认得', async () => {
    const api = createTauriApi();
    // 「中文」的 GBK 编码
    const gbk = [...new TextEncoder().encode('<html><head><meta charset="gb2312"><title>'), 0xd6, 0xd0, 0xce, 0xc4, ...new TextEncoder().encode('</title>')];
    invoke.mockResolvedValueOnce({ contentType: 'text/html', body: gbk });
    expect(await api.web.fetchTitle('https://example.cn')).toBe('中文');
    invoke.mockRejectedValueOnce('timeout');
    expect(await api.web.fetchTitle('https://example.cn')).toBeNull();
  });

  it('检查更新：同一个仓库里只认 lite-v 开头的版本', async () => {
    const api = createTauriApi();
    invoke.mockResolvedValueOnce(JSON.stringify([
      { tag_name: 'v26.5.0', assets: [] },
      { tag_name: 'lite-v26.4.1', html_url: 'https://example.com/r', assets: [{ name: 'iML-Editor-26.4.1-arm64.dmg', browser_download_url: 'https://example.com/a.dmg', size: 9 }] },
    ]));
    expect(await api.app.checkUpdates()).toMatchObject({ success: true, latestVersion: '26.4.1', releaseUrl: 'https://example.com/r' });
    invoke.mockResolvedValueOnce(JSON.stringify([{ tag_name: 'v26.5.0', assets: [] }]));
    expect(await api.app.checkUpdates()).toEqual({ success: false, error: '未发现任何发布版本' });
    invoke.mockRejectedValueOnce('offline');
    expect(await api.app.checkUpdates()).toMatchObject({ success: false });
  });

  it('事件：Rust 发来的和界面自己发的，落到同一个监听上；保存设置后广播 settings:changed', async () => {
    const api = createTauriApi();
    const seen: unknown[] = [];
    api.events.on('dialog:open', (id) => seen.push(id));
    api.events.on('dialog:open', (id) => seen.push(`again:${id}`));
    // 同一个频道只向 Tauri 订阅一次
    expect(listen.mock.calls.filter((c) => (c as unknown[])[0] === 'dialog:open').length).toBe(1);
    const fromRust = (listen.mock.calls[0] as unknown[])[1] as (event: { payload: unknown }) => void;
    fromRust({ payload: 'about' });
    api.app.openSettings();
    expect(seen).toEqual(['about', 'again:about', 'settings', 'again:settings']);

    const changed = vi.fn();
    api.events.on('settings:changed', changed);
    invoke.mockResolvedValueOnce(undefined);
    expect(await api.app.saveSettings({ autoSave: true })).toEqual({ success: true });
    expect(changed).toHaveBeenCalledWith({ autoSave: true });
  });

  it('本地图片地址的前缀按平台给：Windows 的 WebView2 不认自定义协议的写法', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get');
    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');
    expect(createTauriApi()).toMatchObject({ assetBase: 'iml-asset://localhost/', app: { platform: 'darwin' } });
    ua.mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/124.0');
    expect(createTauriApi()).toMatchObject({ assetBase: 'http://iml-asset.localhost/', app: { platform: 'win32' } });
    ua.mockRestore();
  });
});
