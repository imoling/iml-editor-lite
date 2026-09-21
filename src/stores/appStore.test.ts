import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createMockApi } from '../test/setup';
import { useAppStore, readLibraryDir } from './appStore';

const LIB = '/lib';
const initialState = useAppStore.getInitialState();

function useApi(files: Record<string, string>) {
  const api = createMockApi(files);
  (window as any).api = api;
  return api;
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ ...initialState, tabs: [], expandedPaths: [], recentFiles: [] }, true);
});

describe('updateTabContent', () => {
  it('内容没变时不把标签页标脏', () => {
    useAppStore.setState({ tabs: [{ id: '/lib/a.md', title: 'a', content: 'x', isDirty: false, mode: 'word' }] });
    useAppStore.getState().updateTabContent('/lib/a.md', 'x');
    expect(useAppStore.getState().tabs[0].isDirty).toBe(false);
    useAppStore.getState().updateTabContent('/lib/a.md', 'y');
    expect(useAppStore.getState().tabs[0]).toMatchObject({ content: 'y', isDirty: true });
  });
});

describe('editTabContent：编辑器之外的功能改写文档', () => {
  it('先把编辑器里没写回的字刷进来，再基于最新内容改；并留下记号让富文本编辑器重载', () => {
    useAppStore.setState({ tabs: [{ id: '/lib/a.md', title: 'a', content: '旧', isDirty: false, mode: 'word' }] });
    // 模拟编辑器里还压着 150ms 防抖没写回的字
    useAppStore.getState().registerEditorFlush(() => useAppStore.getState().updateTabContent('/lib/a.md', '旧 + 刚打的字'));
    expect(useAppStore.getState().editTabContent('/lib/a.md', (c) => `${c}\n\n转写块`)).toBe(true);
    expect(useAppStore.getState().tabs[0]).toMatchObject({ content: '旧 + 刚打的字\n\n转写块', isDirty: true });
    expect(useAppStore.getState().externalWrite).toEqual({ id: '/lib/a.md', rev: 1 });
    useAppStore.getState().editTabContent('/lib/a.md', (c) => `${c}!`);
    expect(useAppStore.getState().externalWrite?.rev).toBe(2);
  });

  it('内容没变不留记号；笔记已经关掉返回 false', () => {
    useAppStore.setState({ tabs: [{ id: '/lib/a.md', title: 'a', content: 'x', isDirty: false, mode: 'word' }] });
    expect(useAppStore.getState().editTabContent('/lib/a.md', (c) => c)).toBe(true);
    expect(useAppStore.getState().externalWrite).toBeNull();
    expect(useAppStore.getState().tabs[0].isDirty).toBe(false);
    expect(useAppStore.getState().editTabContent('/lib/gone.md', () => 'y')).toBe(false);
  });
});

describe('查找面板开关', () => {
  it('⌘F：开 → 有替换时收起替换 → 关闭并清空查找词', () => {
    const s = useAppStore.getState();
    s.toggleFind();
    expect(useAppStore.getState()).toMatchObject({ findVisible: true, replaceVisible: false });
    s.toggleReplace();
    expect(useAppStore.getState()).toMatchObject({ findVisible: true, replaceVisible: true });
    s.setSearch({ query: 'abc', total: 3, current: 1 });
    s.toggleFind();
    expect(useAppStore.getState()).toMatchObject({ findVisible: true, replaceVisible: false });
    s.toggleFind();
    expect(useAppStore.getState()).toMatchObject({ findVisible: false, replaceVisible: false });
    expect(useAppStore.getState().search).toMatchObject({ query: '', total: 0, current: 0 });
  });

  it('命令被消费后清空，计数只在变化时更新', () => {
    const s = useAppStore.getState();
    s.sendSearchCommand('replaceAll');
    expect(useAppStore.getState().searchCommand).toEqual({ type: 'replaceAll' });
    s.consumeSearchCommand();
    expect(useAppStore.getState().searchCommand).toBeNull();
    const before = useAppStore.getState().search;
    s.setSearchCounts(0, 0);
    expect(useAppStore.getState().search).toBe(before);
  });
});

describe('打开的文件夹', () => {
  it('readLibraryDir 过滤隐藏文件和非文档文件，保留文件夹', async () => {
    useApi({ '/lib/a.md': '', '/lib/.DS_Store': '', '/lib/pic.png': '', '/lib/sub/b.txt': '', '/lib/sub/c.md': '' });
    const nodes = await readLibraryDir(LIB);
    expect(nodes?.map((n) => n.name).sort()).toEqual(['a.md', 'sub']);
  });

  it('loadFolder 设树根并开始监听；打开文件夹外的文件不改变树根；closeFolder 收起树、停止监听，标签页不动', async () => {
    const api = useApi({ '/lib/a.md': 'A', '/lib/sub/b.md': 'B', '/other/x.md': 'X' });
    await useAppStore.getState().loadFolder(LIB);
    expect(useAppStore.getState().workspacePath).toBe(LIB);
    expect(api.folder.watch).toHaveBeenCalledWith(LIB);
    useAppStore.getState().openTab({ id: '/other/x.md', title: 'x', content: 'X', isDirty: false, mode: 'word' });
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().workspacePath).toBe(LIB);
    useAppStore.getState().closeFolder();
    expect(useAppStore.getState()).toMatchObject({ workspacePath: null, fileTree: [] });
    expect(api.folder.watch).toHaveBeenLastCalledWith(null);
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['/other/x.md']);
  });

  it('打开子目录文件时自动展开祖先并加载子节点', async () => {
    useApi({ '/lib/a.md': 'A', '/lib/sub/deep/b.md': 'B' });
    await useAppStore.getState().loadFolder(LIB);
    await useAppStore.getState().setActiveTab('/lib/sub/deep/b.md');
    const { expandedPaths, fileTree } = useAppStore.getState();
    expect(expandedPaths).toEqual(expect.arrayContaining([LIB, '/lib/sub', '/lib/sub/deep']));
    const sub = fileTree.find((n) => n.name === 'sub');
    expect(sub?.children?.[0].name).toBe('deep');
  });

  it('createNoteIn 同名自动加序号', async () => {
    const api = useApi({ '/lib/未命名.md': '' });
    await useAppStore.getState().loadFolder(LIB);
    const created = await useAppStore.getState().createNoteIn(LIB);
    expect(created).toBe('/lib/未命名 2.md');
    expect(api.files.has('/lib/未命名 2.md')).toBe(true);
    expect(useAppStore.getState().renamingPath).toBe(created);
  });

  it('重命名目录时其下的标签页路径一并改写', async () => {
    useApi({ '/lib/sub/b.md': 'B' });
    await useAppStore.getState().loadFolder(LIB);
    useAppStore.setState({
      tabs: [{ id: '/lib/sub/b.md', title: 'b', content: 'B', isDirty: false, mode: 'word' }],
      activeTabId: '/lib/sub/b.md',
    });
    await useAppStore.getState().renameFile('/lib/sub', 'renamed');
    const s = useAppStore.getState();
    expect(s.tabs[0].id).toBe('/lib/renamed/b.md');
    expect(s.activeTabId).toBe('/lib/renamed/b.md');
  });
});

describe('外部改动', () => {
  it('未修改的标签页跟随磁盘，有未保存修改的标签页只打标记', async () => {
    const api = useApi({ '/lib/a.md': 'A2', '/lib/b.md': 'B2' });
    await useAppStore.getState().loadFolder(LIB);
    useAppStore.setState({
      tabs: [
        { id: '/lib/a.md', title: 'a', content: 'A1', isDirty: false, mode: 'word' },
        { id: '/lib/b.md', title: 'b', content: 'B1', isDirty: true, mode: 'word' },
      ],
    });
    await useAppStore.getState().handleExternalChanges(['/lib/a.md', '/lib/b.md']);
    const [a, b] = useAppStore.getState().tabs;
    expect(a).toMatchObject({ content: 'A2', isDirty: false, externallyModified: false });
    expect(b).toMatchObject({ content: 'B1', isDirty: true, externallyModified: true });
    api.files.delete('/lib/a.md');
    await useAppStore.getState().handleExternalChanges(['/lib/a.md']);
    expect(useAppStore.getState().tabs[0].externallyModified).toBe(true);
  });
});

describe('外部改动：不把自己打的字当成「磁盘被改了」', () => {
  it('文件树里新建文件 → 打开 → 用户马上打字，迟到的文件监听通知不该打「外部修改」的标记；磁盘真变了才打', async () => {
    const api = useApi({ '/lib/会议记录.md': '# 会议记录\n\n## 要点\n' });
    await useAppStore.getState().openFileByPath('/lib/会议记录.md');
    useAppStore.getState().updateTabContent('/lib/会议记录.md', '# 会议记录\n\n## 要点\n\n- 老王负责打包');
    await useAppStore.getState().handleExternalChanges(['/lib/会议记录.md']);         // 迟到的「新建」通知：磁盘其实没动
    expect(useAppStore.getState().tabs[0]).toMatchObject({ isDirty: true });
    expect(useAppStore.getState().tabs[0].externallyModified).toBeFalsy();

    api.files.set('/lib/会议记录.md', '# 会议记录\n\n别的编辑器写进来的');
    await useAppStore.getState().handleExternalChanges(['/lib/会议记录.md']);         // 这回磁盘真的被别人改了
    expect(useAppStore.getState().tabs[0].externallyModified).toBe(true);
  });
});

describe('会话恢复', () => {
  it('恢复未保存的修改、丢弃已不存在的文件、保留未命名文档、合并启动时已打开的标签', async () => {
    useApi({ '/lib/a.md': 'disk-a', '/lib/b.md': 'disk-b', '/lib/sub/c.md': 'C' });
    localStorage.setItem('iml_session', JSON.stringify({
      activeTabId: '/lib/gone.md',
      folderPath: LIB,
      expandedPaths: ['/lib/sub'],
      sidebarVisible: true,
      sidebarTab: 'outline',
      recentFiles: ['/lib/a.md'],
      tabs: [
        { id: '/lib/a.md', title: 'a', isDirty: true, mode: 'word', content: 'dirty-a' },
        { id: '/lib/b.md', title: 'b', isDirty: false, mode: 'word' },
        { id: '/lib/gone.md', title: 'gone', isDirty: false, mode: 'word' },
        { id: 'new-1.md', title: '未命名', isDirty: true, mode: 'word', content: 'draft' },
      ],
    }));
    // 启动时通过「打开方式」已经打开了一个文件
    useAppStore.setState({ tabs: [{ id: '/lib/b.md', title: 'b', content: 'pre', isDirty: false, mode: 'word' }], activeTabId: '/lib/b.md' });

    await useAppStore.getState().loadSession();
    const s = useAppStore.getState();
    const ids = s.tabs.map((t) => t.id);
    expect(ids).toEqual(['/lib/a.md', 'new-1.md', '/lib/b.md']);
    expect(s.tabs.find((t) => t.id === '/lib/a.md')).toMatchObject({ content: 'dirty-a', isDirty: true });
    expect(s.tabs.find((t) => t.id === 'new-1.md')).toMatchObject({ content: 'draft' });
    expect(s.tabs.find((t) => t.id === '/lib/b.md')?.content).toBe('pre');
    expect(s.activeTabId).toBe('/lib/b.md');
    // 上次打开的文件夹、展开状态、侧边栏的样子都回来了
    expect(s.workspacePath).toBe(LIB);
    expect(s.expandedPaths).toEqual(expect.arrayContaining([LIB, '/lib/sub']));
    expect(s).toMatchObject({ sidebarVisible: true, sidebarTab: 'outline' });
  });

  it('脏内容与磁盘一致时不再标脏', async () => {
    useApi({ '/lib/a.md': 'same' });
    localStorage.setItem('iml_session', JSON.stringify({
      activeTabId: '/lib/a.md',
      tabs: [{ id: '/lib/a.md', title: 'a', isDirty: true, mode: 'word', content: 'same' }],
    }));
    await useAppStore.getState().loadSession();
    expect(useAppStore.getState().tabs[0]).toMatchObject({ content: 'same', isDirty: false });
  });

  it('上次的文件夹已经不在了：不报错，也不留一个空树根', async () => {
    useApi({ '/elsewhere/a.md': 'A' });
    localStorage.setItem('iml_session', JSON.stringify({ folderPath: '/gone', tabs: [] }));
    expect(await useAppStore.getState().loadSession()).toBe(false);
    expect(useAppStore.getState().workspacePath).toBeNull();
  });
});

describe('未命名文档：从不悄悄建成文件', () => {
  const newTab = (content: string) => {
    useAppStore.getState().createNewFile();
    const id = useAppStore.getState().activeTabId!;
    useAppStore.getState().updateTabContent(id, content);
    return id;
  };

  it('失焦的自动保存碰到未命名文档什么都不写，哪怕打开着文件夹；已有的文件改过了才写', async () => {
    const api = useApi({ '/lib/a.md': 'A' });
    await useAppStore.getState().loadFolder(LIB);
    newTab('# 周报\n\n本周');
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(false);
    expect([...api.files.keys()]).toEqual(['/lib/a.md']);
    expect(api.dialog.save).not.toHaveBeenCalled();

    await useAppStore.getState().openFileByPath('/lib/a.md');
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(true); // 没改过：不写盘
    expect(api.fs.writeFile).not.toHaveBeenCalled();
    useAppStore.getState().updateTabContent('/lib/a.md', 'A2');
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(true);
    expect(api.files.get('/lib/a.md')).toBe('A2');
  });

  it('⌘S：弹保存框，名字先按正文第一行想好、位置默认在打开的文件夹里；取消就什么都不发生', async () => {
    const api = useApi({ '/lib/a.md': 'A' });
    await useAppStore.getState().loadFolder(LIB);
    const id = newTab('**大模型**是指具有大规模参数的模型\n\n正文');
    expect(await useAppStore.getState().saveActiveFile()).toBe(false); // 保存框默认返回 null = 取消
    expect(api.dialog.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '/lib/大模型是指具有大规模参数的模型.md' }));
    expect(useAppStore.getState().activeTabId).toBe(id);

    api.dialog.save.mockResolvedValueOnce('/docs/大模型.md' as never);
    expect(await useAppStore.getState().saveActiveFile()).toBe(true);
    expect(api.files.get('/docs/大模型.md')).toContain('正文');
    expect(useAppStore.getState().activeTabId).toBe('/docs/大模型.md');
  });

  it('没打开文件夹、正文也还没有：保存框里就是一个光秃秃的「未命名.md」', async () => {
    const api = useApi({});
    newTab('');
    await useAppStore.getState().saveActiveFile();
    expect(api.dialog.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '未命名.md' }));
  });
});

describe('打开文件', () => {
  it('选了几个就开几个；已经开着的只是切过去，不会开两份', async () => {
    const api = useApi({ '/a.md': 'A', '/b.md': 'B' });
    api.dialog.open.mockResolvedValueOnce(['/a.md', '/b.md'] as never);
    await useAppStore.getState().openFile();
    api.dialog.open.mockResolvedValueOnce(['/a.md'] as never);
    await useAppStore.getState().openFile();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['/a.md', '/b.md']);
    expect(useAppStore.getState().activeTabId).toBe('/a.md');
  });

  it('打开文件夹：成了树根，侧边栏亮出来停在「文件」页', async () => {
    const api = useApi({ '/lib/a.md': 'A' });
    api.dialog.open.mockResolvedValueOnce([LIB] as never);
    await useAppStore.getState().openDirectory();
    expect(useAppStore.getState()).toMatchObject({ workspacePath: LIB, sidebarVisible: true, sidebarTab: 'files' });
  });
});

describe('弹窗', () => {
  it('openDialog / closeDialog', () => {
    useAppStore.getState().openDialog('about');
    expect(useAppStore.getState().dialog).toBe('about');
    useAppStore.getState().openDialog('settings');
    expect(useAppStore.getState().dialog).toBe('settings');
    useAppStore.getState().closeDialog();
    expect(useAppStore.getState().dialog).toBeNull();
  });
});

describe('标签页：关闭与重开', () => {
  const tab = (id: string, extra: any = {}) => ({ id, title: id.split('/').pop()!, content: '', isDirty: false, mode: 'word' as const, ...extra });

  it('干净的直接关；未保存的先弹确认框，不立刻关掉', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md'), tab('/lib/b.md', { isDirty: true })], activeTabId: '/lib/b.md' });
    useAppStore.getState().requestCloseTab('/lib/a.md');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['/lib/b.md']);
    expect(useAppStore.getState().tabToClose).toBeNull();

    useAppStore.getState().requestCloseTab('/lib/b.md');
    expect(useAppStore.getState().tabToClose).toBe('/lib/b.md');
    expect(useAppStore.getState().tabs).toHaveLength(1);   // 还没真关
  });

  it('空白的未命名文档直接关，写了东西的要确认', () => {
    useAppStore.setState({ tabs: [tab('new-1'), tab('new-2', { content: '写了一半' })] });
    useAppStore.getState().requestCloseTab('new-1');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['new-2']);
    useAppStore.getState().requestCloseTab('new-2');
    expect(useAppStore.getState().tabToClose).toBe('new-2');
  });

  it('⌘⇧T 按关闭顺序倒着开回来；未命名文档没有路径，不进栈', async () => {
    useApi({ '/lib/a.md': 'A', '/lib/b.md': 'B' });
    useAppStore.setState({ tabs: [tab('/lib/a.md'), tab('/lib/b.md'), tab('new-1')] });
    useAppStore.getState().closeTab('/lib/a.md');
    useAppStore.getState().closeTab('new-1');
    useAppStore.getState().closeTab('/lib/b.md');
    expect(useAppStore.getState().closedTabs).toEqual(['/lib/a.md', '/lib/b.md']);

    await useAppStore.getState().reopenClosedTab();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['/lib/b.md']);
    await useAppStore.getState().reopenClosedTab();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['/lib/b.md', '/lib/a.md']);
    // 栈空了再按不该出错
    await useAppStore.getState().reopenClosedTab();
    expect(useAppStore.getState().tabs).toHaveLength(2);
  });

  it('已经又打开的文件会被跳过，不会重复开同一个', async () => {
    useApi({ '/lib/a.md': 'A', '/lib/b.md': 'B' });
    useAppStore.setState({ tabs: [tab('/lib/b.md')], closedTabs: ['/lib/a.md', '/lib/b.md'] });
    await useAppStore.getState().reopenClosedTab();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['/lib/b.md', '/lib/a.md']);
  });

  it('重复关同一个文件不会在栈里留两份，且最多记 10 个', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md')], closedTabs: ['/lib/a.md', '/lib/x.md'] });
    useAppStore.getState().closeTab('/lib/a.md');
    expect(useAppStore.getState().closedTabs).toEqual(['/lib/x.md', '/lib/a.md']);

    const many = Array.from({ length: 10 }, (_, i) => `/lib/${i}.md`);
    useAppStore.setState({ tabs: [tab('/lib/new.md')], closedTabs: many });
    useAppStore.getState().closeTab('/lib/new.md');
    const stack = useAppStore.getState().closedTabs;
    expect(stack).toHaveLength(10);
    expect(stack[stack.length - 1]).toBe('/lib/new.md');
    expect(stack).not.toContain('/lib/0.md');   // 最旧的被挤出去
  });
});

describe('没有欢迎页：永远有一篇文档开着', () => {
  it('关掉最后一个标签页，回到一篇空白文档；关的那个文件照样能用 ⌘⇧T 开回来', async () => {
    useApi({ '/lib/a.md': 'A' });
    await useAppStore.getState().openFileByPath('/lib/a.md');
    useAppStore.getState().requestCloseTab('/lib/a.md');
    const s = useAppStore.getState();
    expect(s.tabs).toMatchObject([{ title: '未命名', content: '', isDirty: false }]);
    expect(s.tabs[0].id.startsWith('new-')).toBe(true);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.closedTabs).toEqual(['/lib/a.md']);

    // 开回来的文件顶替掉那篇没动过的空白文档，不留一个没用的「未命名」
    await useAppStore.getState().reopenClosedTab();
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(['/lib/a.md']);
  });

  it('空白文档只在「只有它一个、而且没动过」时才被顶替：写了字的、旁边还有别的标签页的，都留着', async () => {
    useApi({ '/lib/a.md': 'A', '/lib/b.md': 'B' });
    useAppStore.getState().createNewFile();
    const draft = useAppStore.getState().activeTabId!;
    useAppStore.getState().updateTabContent(draft, '随手记一句');
    await useAppStore.getState().openFileByPath('/lib/a.md');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([draft, '/lib/a.md']);

    useAppStore.getState().createNewFile();   // 旁边有别的标签页：新的空白文档照常加在后面
    const blank = useAppStore.getState().activeTabId!;
    await useAppStore.getState().openFileByPath('/lib/b.md');
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual([draft, '/lib/a.md', blank, '/lib/b.md']);
  });

  it('连按两次 ⌘N 不会攒出两篇空白文档', () => {
    useAppStore.getState().createNewFile();
    useAppStore.getState().createNewFile();
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });
});

describe('标签页：批量关闭', () => {
  const tab = (id: string, extra: any = {}) => ({ id, title: id.split('/').pop()!, content: 'x', isDirty: false, mode: 'word' as const, ...extra });
  const ids = () => useAppStore.getState().tabs.map((t) => t.id);

  it('关闭其他：干净的立刻关掉，只留下自己', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md'), tab('/lib/b.md'), tab('/lib/c.md')], activeTabId: '/lib/b.md' });
    useAppStore.getState().closeOtherTabs('/lib/b.md');
    expect(ids()).toEqual(['/lib/b.md']);
    expect(useAppStore.getState().tabToClose).toBeNull();
  });

  it('关闭右侧：只关右边的，左边和自己不动', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md'), tab('/lib/b.md'), tab('/lib/c.md'), tab('/lib/d.md')] });
    useAppStore.getState().closeTabsToRight('/lib/b.md');
    expect(ids()).toEqual(['/lib/a.md', '/lib/b.md']);
  });

  it('关闭已保存的：改过的留着，永远不弹确认框', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md'), tab('/lib/b.md', { isDirty: true }), tab('new-1', { content: '草稿' }), tab('new-2', { content: '  ' })] });
    useAppStore.getState().closeSavedTabs();
    expect(ids()).toEqual(['/lib/b.md', 'new-1']);   // 空白的 new-2 也算已保存，被关掉
    expect(useAppStore.getState().tabToClose).toBeNull();
  });

  it('全部关闭：脏的排队逐个问，干净的直接没了', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md'), tab('/lib/b.md', { isDirty: true }), tab('/lib/c.md', { isDirty: true })] });
    useAppStore.getState().closeAllTabs();
    expect(ids()).toEqual(['/lib/b.md', '/lib/c.md']);
    expect(useAppStore.getState().tabToClose).toBe('/lib/b.md');
    expect(useAppStore.getState().pendingCloseIds).toEqual(['/lib/c.md']);

    // 「不保存」→ 关掉当前这个，轮到下一个
    useAppStore.getState().closeTab('/lib/b.md');
    useAppStore.getState().advanceCloseQueue();
    expect(useAppStore.getState().tabToClose).toBe('/lib/c.md');
    expect(useAppStore.getState().pendingCloseIds).toEqual([]);

    useAppStore.getState().closeTab('/lib/c.md');
    useAppStore.getState().advanceCloseQueue();
    expect(useAppStore.getState().tabToClose).toBeNull();
    // 全关完了不是一片空白的欢迎页，而是一篇空白文档
    expect(useAppStore.getState().tabs).toMatchObject([{ title: '未命名', content: '', isDirty: false }]);
    expect(useAppStore.getState().activeTabId).toBe(ids()[0]);
  });

  it('确认框上点「取消」= 放弃整批，不是只跳过这一个', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md', { isDirty: true }), tab('/lib/b.md', { isDirty: true })] });
    useAppStore.getState().closeAllTabs();
    expect(useAppStore.getState().pendingCloseIds).toEqual(['/lib/b.md']);
    useAppStore.getState().cancelCloseQueue();
    expect(useAppStore.getState().tabToClose).toBeNull();
    expect(useAppStore.getState().pendingCloseIds).toEqual([]);
    expect(ids()).toEqual(['/lib/a.md', '/lib/b.md']);   // 一个都没关
  });

  it('批量关掉的文件都进重开栈，⌘⇧T 能一个个开回来', () => {
    useAppStore.setState({ tabs: [tab('/lib/a.md'), tab('/lib/b.md'), tab('/lib/c.md')], closedTabs: [] });
    useAppStore.getState().closeOtherTabs('/lib/c.md');
    expect(useAppStore.getState().closedTabs).toEqual(['/lib/a.md', '/lib/b.md']);
  });
});

describe('状态栏提示', () => {
  it('普通提示 5 秒后消失；带按钮的多停一会儿（15 秒），按钮原样带在提示上', () => {
    vi.useFakeTimers();
    try {
      useAppStore.getState().notify('已保存');
      expect(useAppStore.getState().notice).toMatchObject({ text: '已保存' });
      expect(useAppStore.getState().notice?.actions).toBeUndefined();
      vi.advanceTimersByTime(5000);
      expect(useAppStore.getState().notice).toBeNull();

      const run = vi.fn();
      useAppStore.getState().notify('已导出 PDF', undefined, [{ label: '打开', run }]);
      vi.advanceTimersByTime(5000);
      expect(useAppStore.getState().notice?.actions?.map((a) => a.label)).toEqual(['打开']);
      vi.advanceTimersByTime(10000);
      expect(useAppStore.getState().notice).toBeNull();
      expect(run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('旧提示的定时器不会把后来的提示收掉', () => {
    vi.useFakeTimers();
    try {
      useAppStore.getState().notify('第一条');
      vi.advanceTimersByTime(4000);
      vi.setSystemTime(Date.now() + 1); // 两条提示要有不同的 id
      useAppStore.getState().notify('第二条');
      vi.advanceTimersByTime(1500);
      expect(useAppStore.getState().notice?.text).toBe('第二条');
    } finally {
      vi.useRealTimers();
    }
  });
});
