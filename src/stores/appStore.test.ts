import { describe, expect, it, beforeEach } from 'vitest';
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
  useAppStore.setState({ ...initialState, tabs: [], expandedPaths: [], starredFiles: [], recentFiles: [] }, true);
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

describe('editTabContent：编辑器之外的功能改写笔记（转写、纪要）', () => {
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

describe('笔记库', () => {
  it('readLibraryDir 过滤隐藏文件和非笔记文件，保留文件夹', async () => {
    useApi({ '/lib/a.md': '', '/lib/.DS_Store': '', '/lib/pic.png': '', '/lib/sub/b.txt': '', '/lib/sub/c.md': '' });
    const nodes = await readLibraryDir(LIB);
    expect(nodes?.map((n) => n.name).sort()).toEqual(['a.md', 'sub']);
  });

  it('loadLibrary 设树根并开始监听；setActiveTab 不再改变树根', async () => {
    const api = useApi({ '/lib/a.md': 'A', '/lib/sub/b.md': 'B', '/other/x.md': 'X' });
    await useAppStore.getState().loadLibrary(LIB);
    expect(useAppStore.getState().workspacePath).toBe(LIB);
    expect(api.library.watch).toHaveBeenCalledWith(LIB);
    useAppStore.getState().openTab({ id: '/other/x.md', title: 'x', content: 'X', isDirty: false, mode: 'word' });
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().workspacePath).toBe(LIB);
  });

  it('打开子目录文件时自动展开祖先并加载子节点', async () => {
    useApi({ '/lib/a.md': 'A', '/lib/sub/deep/b.md': 'B' });
    await useAppStore.getState().loadLibrary(LIB);
    await useAppStore.getState().setActiveTab('/lib/sub/deep/b.md');
    const { expandedPaths, fileTree } = useAppStore.getState();
    expect(expandedPaths).toEqual(expect.arrayContaining([LIB, '/lib/sub', '/lib/sub/deep']));
    const sub = fileTree.find((n) => n.name === 'sub');
    expect(sub?.children?.[0].name).toBe('deep');
  });

  it('createNoteIn 同名自动加序号', async () => {
    const api = useApi({ '/lib/未命名笔记.md': '' });
    await useAppStore.getState().loadLibrary(LIB);
    const created = await useAppStore.getState().createNoteIn(LIB);
    expect(created).toBe('/lib/未命名笔记 2.md');
    expect(api.files.has('/lib/未命名笔记 2.md')).toBe(true);
    expect(useAppStore.getState().renamingPath).toBe(created);
  });

  it('重命名目录时其下的标签页与收藏路径一并改写', async () => {
    useApi({ '/lib/sub/b.md': 'B' });
    await useAppStore.getState().loadLibrary(LIB);
    useAppStore.setState({
      tabs: [{ id: '/lib/sub/b.md', title: 'b', content: 'B', isDirty: false, mode: 'word' }],
      activeTabId: '/lib/sub/b.md',
      starredFiles: ['/lib/sub/b.md'],
    });
    await useAppStore.getState().renameFile('/lib/sub', 'renamed');
    const s = useAppStore.getState();
    expect(s.tabs[0].id).toBe('/lib/renamed/b.md');
    expect(s.activeTabId).toBe('/lib/renamed/b.md');
    expect(s.starredFiles).toEqual(['/lib/renamed/b.md']);
  });
});

describe('外部改动', () => {
  it('未修改的标签页跟随磁盘，有未保存修改的标签页只打标记', async () => {
    const api = useApi({ '/lib/a.md': 'A2', '/lib/b.md': 'B2' });
    await useAppStore.getState().loadLibrary(LIB);
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

describe('会话恢复', () => {
  it('恢复未保存的修改、丢弃已不存在的文件、保留未命名文档、合并启动时已打开的标签', async () => {
    useApi({ '/lib/a.md': 'disk-a', '/lib/b.md': 'disk-b' });
    await useAppStore.getState().loadLibrary(LIB);
    localStorage.setItem('iml_session', JSON.stringify({
      activeTabId: '/lib/gone.md',
      expandedPaths: ['/lib/sub'],
      starredFiles: ['/lib/a.md'],
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
    expect(s.starredFiles).toEqual(['/lib/a.md']);
    expect(s.expandedPaths).toEqual(expect.arrayContaining([LIB, '/lib/sub']));
  });

  it('脏内容与磁盘一致时不再标脏', async () => {
    useApi({ '/lib/a.md': 'same' });
    await useAppStore.getState().loadLibrary(LIB);
    localStorage.setItem('iml_session', JSON.stringify({
      activeTabId: '/lib/a.md',
      tabs: [{ id: '/lib/a.md', title: 'a', isDirty: true, mode: 'word', content: 'same' }],
    }));
    await useAppStore.getState().loadSession();
    expect(useAppStore.getState().tabs[0]).toMatchObject({ content: 'same', isDirty: false });
  });
});

describe('日记与模板', () => {
  it('今日日记：不存在则用内置模板新建并打开，再次调用不覆盖', async () => {
    const api = useApi({ '/lib/a.md': 'A' });
    await useAppStore.getState().loadLibrary(LIB);
    await useAppStore.getState().openDailyNote();
    const today = new Date();
    const name = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const path = `/lib/日记/${name}.md`;
    expect(api.files.get(path)).toContain(`# ${name}`);
    expect(useAppStore.getState().activeTabId).toBe(path);
    api.files.set(path, '已写过的内容');
    await useAppStore.getState().openDailyNote();
    expect(api.files.get(path)).toBe('已写过的内容');
  });

  it('优先使用笔记库里的「模板/日记.md」', async () => {
    const api = useApi({ '/lib/模板/日记.md': '自定义 {{date}}' });
    await useAppStore.getState().loadLibrary(LIB);
    await useAppStore.getState().openDailyNote();
    const created = [...api.files.keys()].find((p) => p.startsWith('/lib/日记/'))!;
    expect(api.files.get(created)).toMatch(/^自定义 \d{4}-\d{2}-\d{2}$/);
  });

  it('列出模板并用模板新建笔记（同名自动加序号，变量已替换）', async () => {
    const api = useApi({ '/lib/模板/会议记录.md': '# {{title}}\n{{date}}', '/lib/模板/.hidden.md': 'x' });
    await useAppStore.getState().loadLibrary(LIB);
    expect(await useAppStore.getState().listTemplates()).toEqual([{ name: '会议记录', path: '/lib/模板/会议记录.md' }]);
    const first = await useAppStore.getState().createNoteFromTemplate('/lib/模板/会议记录.md', LIB);
    const second = await useAppStore.getState().createNoteFromTemplate('/lib/模板/会议记录.md', LIB);
    expect(first).toMatch(/^\/lib\/会议记录 \d{4}-\d{2}-\d{2}\.md$/);
    expect(second).toBe(first!.replace('.md', ' 2.md'));
    expect(api.files.get(first!)).toMatch(/^# 会议记录 \d{4}-\d{2}-\d{2}\n\d{4}-\d{2}-\d{2}$/);
    expect(useAppStore.getState().renamingPath).toBe(second);
  });

  it('createSampleTemplates 写入示例且不覆盖已有模板', async () => {
    const api = useApi({ '/lib/模板/日记.md': 'mine' });
    await useAppStore.getState().loadLibrary(LIB);
    await useAppStore.getState().createSampleTemplates();
    expect(api.files.get('/lib/模板/日记.md')).toBe('mine');
    expect(api.files.has('/lib/模板/会议记录.md')).toBe(true);
    expect(api.files.has('/lib/模板/读书笔记.md')).toBe(true);
  });
});

describe('双向链接', () => {
  it('按文件名或标题解析，优先同目录；找不到则在当前笔记目录新建', async () => {
    const api = useApi({ '/lib/a.md': 'A', '/lib/sub/b.md': 'B', '/lib/sub/目标.md': 'in sub', '/lib/目标.md': 'in root' });
    (window as any).api.search.listNotes = async () => [
      { path: '/lib/sub/目标.md', title: '目标' },
      { path: '/lib/目标.md', title: '目标' },
      { path: '/lib/a.md', title: '标题A' },
    ];
    await useAppStore.getState().loadLibrary(LIB);
    useAppStore.setState({ tabs: [{ id: '/lib/sub/b.md', title: 'b', content: 'B', isDirty: false, mode: 'word' }], activeTabId: '/lib/sub/b.md' });
    await useAppStore.getState().openWikiLink('目标');
    expect(useAppStore.getState().activeTabId).toBe('/lib/sub/目标.md');
    await useAppStore.getState().openWikiLink('标题A');
    expect(useAppStore.getState().activeTabId).toBe('/lib/a.md');
    useAppStore.getState().setActiveTab('/lib/sub/b.md');
    await useAppStore.getState().openWikiLink('新想法');
    expect(api.files.get('/lib/sub/新想法.md')).toBe('# 新想法\n\n');
    expect(useAppStore.getState().activeTabId).toBe('/lib/sub/新想法.md');
  });
});

describe('未命名文档的静默保存', () => {
  const newTab = (content: string) => {
    useAppStore.getState().createNewFile();
    const id = useAppStore.getState().activeTabId!;
    useAppStore.getState().updateTabContent(id, content);
    return id;
  };

  it('空文档或只有符号的文档不落盘，内容有了正文才按第一行命名', async () => {
    const api = useApi({ '/lib/a.md': 'A' });
    await useAppStore.getState().loadLibrary(LIB);
    const id = newTab('');
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(false);
    expect(api.files.size).toBe(1);

    useAppStore.getState().updateTabContent(id, '$$\n\n$$');
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(false);
    expect([...api.files.keys()].some((p) => p.includes('$$'))).toBe(false);

    useAppStore.getState().updateTabContent(id, '**大模型**是指具有大规模参数的模型\n\n正文');
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(true);
    expect(api.files.get('/lib/大模型是指具有大规模参数的模型.md')).toContain('正文');
    expect(useAppStore.getState().activeTabId).toBe('/lib/大模型是指具有大规模参数的模型.md');
  });

  it('AI 生成期间不落盘；同名自动加序号', async () => {
    const api = useApi({ '/lib/周报.md': 'old' });
    await useAppStore.getState().loadLibrary(LIB);
    newTab('# 周报\n\n本周');
    useAppStore.getState().setAIStatus({ generating: true });
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(false);
    useAppStore.getState().setAIStatus({ generating: false });
    expect(await useAppStore.getState().saveActiveFile(false, true)).toBe(true);
    expect(api.files.get('/lib/周报 2.md')).toContain('本周');
    expect(api.files.get('/lib/周报.md')).toBe('old');
  });
});

describe('弹窗', () => {
  it('openDialog / closeDialog', () => {
    useAppStore.getState().openDialog('ai-config');
    expect(useAppStore.getState().dialog).toBe('ai-config');
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
    expect(ids()).toEqual([]);
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
