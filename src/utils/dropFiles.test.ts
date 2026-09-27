import { describe, expect, it, beforeEach } from 'vitest';
import { createMockApi } from '../test/setup';
import { useAppStore } from '../stores/appStore';
import { handleDroppedFiles, isFileDrag, matchPaths, openDropped } from './dropFiles';

const initialState = useAppStore.getInitialState();
const file = (name: string, type = '') => new File(['x'], name, { type });

beforeEach(() => {
  useAppStore.setState({ ...initialState, tabs: [], expandedPaths: [], recentFiles: [] }, true);
});

describe('拖进窗口的文件', () => {
  it('只有拖磁盘上的文件才算：页面内拖文字不算', () => {
    expect(isFileDrag({ types: ['Files'] } as any)).toBe(true);
    expect(isFileDrag({ types: ['text/plain', 'text/html'] } as any)).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });

  it('按文件名把壳给的路径对上：同名按顺序，对不上的丢掉；Windows 的反斜杠路径也认', () => {
    const paths = [
      { path: 'C:\\docs\\a.md', isDirectory: false },
      { path: '/x/b.md', isDirectory: false },
      { path: '/y/b.md', isDirectory: false },
    ];
    expect(matchPaths([file('b.md'), file('a.md'), file('b.md'), file('zzz.md')], paths).map((p) => p.path))
      .toEqual(['/x/b.md', 'C:\\docs\\a.md', '/y/b.md']);
  });

  it('文档打开成标签页，文件夹打开到侧边栏，别的说一声', async () => {
    (window as any).api = createMockApi({ '/lib/a.md': '# a', '/lib/b.txt': 'b', '/lib/sub/c.md': 'c' });
    await openDropped([
      { path: '/lib/a.md', isDirectory: false },
      { path: '/lib/b.txt', isDirectory: false },
      { path: '/lib/sub', isDirectory: true },
      { path: '/lib/x.pdf', isDirectory: false },
    ]);
    const s = useAppStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual(['/lib/a.md', '/lib/b.txt']);
    expect(s.workspacePath).toBe('/lib/sub');
    expect(s).toMatchObject({ sidebarTab: 'files', sidebarVisible: true });
    expect(s.notice?.text).toBe('打不开 x.pdf：只认 Markdown 和纯文本文件');
  });

  it('壳给不出路径（拖来的不是磁盘上的文件）：说一声，什么都不开', async () => {
    const api = createMockApi({ '/lib/a.md': '# a' });
    (api.app as any).droppedPaths = async () => [];
    (window as any).api = api;
    await handleDroppedFiles([file('a.md')]);
    expect(useAppStore.getState().tabs).toEqual([]);
    expect(useAppStore.getState().notice?.text).toBe('打不开 a.md：拿不到它在磁盘上的位置，改用「打开」菜单');
  });
});
