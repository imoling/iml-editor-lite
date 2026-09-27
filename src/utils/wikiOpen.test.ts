import { describe, expect, it, beforeEach } from 'vitest';
import { createMockApi } from '../test/setup';
import { useAppStore } from '../stores/appStore';
import { openWikiLink } from './wikiOpen';

const initialState = useAppStore.getInitialState();
const tab = (id: string, content = '') => ({ id, title: id.split('/').pop() || id, content, isDirty: false, mode: 'word' as const });
const settle = () => new Promise((r) => setTimeout(r, 220));

function open(files: Record<string, string>, active: string | null, workspacePath: string | null = null) {
  const api = createMockApi(files);
  (window as any).api = api;
  useAppStore.setState({
    tabs: active ? [tab(active, files[active] ?? '')] : [],
    activeTabId: active,
    workspacePath,
  });
  return api;
}

beforeEach(() => {
  useAppStore.setState({ ...initialState, tabs: [], expandedPaths: [], recentFiles: [] }, true);
});

describe('点 [[链接]]', () => {
  it('同一个文件夹里的同名文档：直接打开', async () => {
    open({ '/lib/a.md': '[[周会]]', '/lib/周会.md': '# 周会' }, '/lib/a.md');
    await openWikiLink('周会');
    expect(useAppStore.getState().activeTabId).toBe('/lib/周会.md');
  });

  it('当前文件夹里没有：到侧边栏打开的文件夹里往下找；带路径的按路径结尾对', async () => {
    open({ '/lib/a.md': '', '/lib/项目/深/周会.md': '# 周会', '/lib/别处/周会记录.md': '' }, '/lib/a.md', '/lib');
    await openWikiLink('周会');
    expect(useAppStore.getState().activeTabId).toBe('/lib/项目/深/周会.md');
    await openWikiLink('别处/周会记录');
    expect(useAppStore.getState().activeTabId).toBe('/lib/别处/周会记录.md');
  });

  it('没打开文件夹：`[[子文件夹/笔记]]` 按相对当前文档的路径找', async () => {
    open({ '/lib/a.md': '', '/lib/项目/周会.md': '# 周会' }, '/lib/a.md');
    await openWikiLink('项目/周会');
    expect(useAppStore.getState().activeTabId).toBe('/lib/项目/周会.md');
  });

  it('[[笔记#小节]]：打开后跳到那一节；没有这一节就说一声', async () => {
    open({ '/lib/a.md': '', '/lib/周会.md': '# 周会\n\n## 议题\n\n## 决定\n' }, '/lib/a.md');
    await openWikiLink('周会#决定');
    await settle();
    expect(useAppStore.getState().navigationRequest?.heading).toMatchObject({ level: 2, text: '决定' });
    useAppStore.getState().setActiveTab('/lib/a.md');
    await openWikiLink('周会#不存在');
    await settle();
    expect(useAppStore.getState().notice?.text).toBe('「周会」里没有「不存在」这一节');
  });

  it('[[#小节]]：在这一篇里跳', async () => {
    open({ '/lib/a.md': '# 甲\n\n## 乙\n' }, '/lib/a.md');
    await openWikiLink('#乙');
    expect(useAppStore.getState().navigationRequest?.heading).toMatchObject({ text: '乙' });
    expect(useAppStore.getState().activeTabId).toBe('/lib/a.md');
  });

  it('没找到：提示里带「新建」，点了才在当前文件夹里建出来并打开', async () => {
    const api = open({ '/lib/a.md': '' }, '/lib/a.md');
    await openWikiLink('新想法');
    const notice = useAppStore.getState().notice;
    expect(notice?.text).toBe('没找到「新想法」');
    expect(api.files.has('/lib/新想法.md')).toBe(false);
    notice?.actions?.[0].run();
    await settle();
    expect(notice?.actions?.[0].label).toBe('新建');
    expect(api.files.get('/lib/新想法.md')).toBe('# 新想法\n\n');
    expect(useAppStore.getState().activeTabId).toBe('/lib/新想法.md');
  });

  it('文档还没保存、也没打开文件夹：没处可找，说清楚该做什么；往上跳出文件夹的写法只找不建', async () => {
    open({}, 'new-1');
    await openWikiLink('周会');
    expect(useAppStore.getState().notice).toMatchObject({ text: '没找到「周会」：先保存这篇文档，或者打开一个文件夹' });
    open({ '/lib/sub/a.md': '' }, '/lib/sub/a.md');
    await openWikiLink('../../etc/x');
    expect(useAppStore.getState().notice?.text).toBe('没找到「../../etc/x」');
    expect(useAppStore.getState().notice?.actions).toBeUndefined();
  });
});
