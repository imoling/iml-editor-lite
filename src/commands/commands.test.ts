import { describe, expect, it, beforeEach } from 'vitest';
import { COMMANDS, rankCommands, displayShortcut, AppCommand } from './commands';
import { useAppStore } from '../stores/appStore';

const titles = (query: string, recent: string[] = []) => rankCommands(COMMANDS, query, recent).map((h) => h.command.title);

beforeEach(() => {
  useAppStore.setState({ tabs: [{ id: '/lib/a.md', title: 'a.md', content: 'A', isDirty: false, mode: 'word' }], activeTabId: '/lib/a.md', aiEnabled: true, closedTabs: [], dialog: null });
});

describe('命令注册表', () => {
  it('id 不重复；每条都有标题和分组', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(COMMANDS.every((c) => c.title && c.group)).toBe(true);
  });

  it('同一个快捷键不会标在两条命令上', () => {
    const keys = COMMANDS.map((c) => c.shortcut).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('rankCommands', () => {
  it('中文、拼音首字母、英文都能找到同一条', () => {
    expect(titles('导出')[0]).toMatch(/^导出为/);
    expect(titles('专注')[0]).toBe('专注模式');
    expect(titles('focus')[0]).toBe('专注模式');
    expect(titles('bbls')[0]).toBe('版本历史…');
    expect(titles('export pdf')[0]).toBe('导出为 PDF');
  });

  it('标题命中排在关键词命中前面；多个词都得命中', () => {
    const forSearch = titles('搜索');
    expect(forSearch[0]).toBe('全库搜索');
    expect(titles('外观 深')[0]).toBe('外观：深色');
    expect(titles('外观 深')).toHaveLength(1);
    expect(titles('这个命令肯定没有')).toEqual([]);
  });

  it('现在用不了的不列出来', () => {
    expect(titles('保存')).toContain('保存');
    useAppStore.setState({ tabs: [], activeTabId: null });
    expect(titles('保存')).not.toContain('保存');
    expect(titles('版本历史')).toEqual([]);
    useAppStore.setState({ aiEnabled: false });
    expect(titles('问你的笔记')).toEqual([]);
    // 还没存过盘的新文档：能保存，但没有版本历史、没法在访达里显示
    useAppStore.setState({ tabs: [{ id: 'new-1', title: '未命名', content: '', isDirty: false, mode: 'word' }], activeTabId: 'new-1' });
    expect(titles('保存')).toContain('保存');
    expect(titles('版本历史')).toEqual([]);
  });

  it('没输入时最近用过的排最前，其余保持表里的顺序', () => {
    const all = titles('', ['view.focus', 'file.daily']);
    expect(all.slice(0, 2)).toEqual(['专注模式', '今日日记']);
    expect(all[2]).toBe('新建文档');
    expect(all.filter((t) => t === '专注模式')).toHaveLength(1);
  });

  it('高亮区间落在标题上', () => {
    const hit = rankCommands(COMMANDS, '历史')[0];
    expect(hit.ranges.map(([a, b]) => hit.command.title.slice(a, b))).toEqual(['历史']);
  });

  it('两个词命中标题里重叠的一段：区间合并，不重叠', () => {
    const hit = rankCommands(COMMANDS, '标签 标')[0];
    expect(hit.ranges.every(([a, b], i, all) => a < b && (i === 0 || all[i - 1][1] <= a))).toBe(true);
    expect(hit.ranges.map(([a, b]) => hit.command.title.slice(a, b))).toEqual(['标签']);
  });

  it('「插入…」取自斜杠菜单：只有富文本编辑器开着时才列出来，执行时交给编辑器', () => {
    expect(titles('表格')).toEqual([]);                                    // 没有编辑器注册 runSlash
    const ran: string[] = [];
    useAppStore.setState({ mode: 'word', editorActions: { insertText: () => true, startList: () => {}, runSlash: (id) => { ran.push(id); return true; } } });
    expect(titles('表格')[0]).toBe('插入：表格');
    expect(titles('gs')).toContain('插入：公式');                          // 拼音首字母沿用斜杠菜单的关键词
    expect(titles('标题 2')[0]).toBe('转为：标题 2');
    rankCommands(COMMANDS, '提示块')[0].command.run();
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatch(/callout|note/);
    // 源码模式下没有这一组；「今日日记」不重复出现
    useAppStore.setState({ mode: 'markdown' });
    expect(titles('表格')).toEqual([]);
    useAppStore.setState({ mode: 'word' });
    expect(titles('今日日记')).toEqual(['今日日记']);
    useAppStore.setState({ editorActions: null });
  });

  it('执行的是 store 里真正的动作', () => {
    const run = (id: string) => (COMMANDS.find((c) => c.id === id) as AppCommand).run();
    run('help.settings');
    expect(useAppStore.getState().dialog).toBe('settings');
    useAppStore.setState({ sidebarVisible: false, sidebarTab: 'library' });
    run('sidebar.tags');
    expect(useAppStore.getState()).toMatchObject({ sidebarVisible: true, sidebarTab: 'tags' });
    run('sidebar.outline');
    expect(useAppStore.getState().sidebarTab).toBe('catalog');
    run('theme.dark');
    expect(useAppStore.getState().appearanceMode).toBe('dark');
  });
});

describe('displayShortcut', () => {
  it('mac 原样；Windows 换成 Ctrl / Alt / Shift 并按习惯排序', () => {
    expect(displayShortcut('⇧⌘P', true)).toBe('⇧⌘P');
    expect(displayShortcut('⇧⌘P', false)).toBe('Ctrl+Shift+P');
    expect(displayShortcut('⌥⌘F', false)).toBe('Ctrl+Alt+F');
    expect(displayShortcut('⌘\\', false)).toBe('Ctrl+\\');
    expect(displayShortcut('⌘,', false)).toBe('Ctrl+,');
  });
});
