import { describe, expect, it, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../components/Editor/editorExtensions';
import { markdownToHtml } from '../utils/markdown';
import { serializeDoc } from '../utils/incrementalMarkdown';
import { registerSource } from '../utils/sourceMap';

/**
 * 属性卡片的逐字段编辑，走真实的编辑器：点控件 → 节点属性变 → 存成 Markdown。
 * 要守住的是：除了被改的那个字段，文件里别的字符都不动。
 */
const MD = [
  '---',
  '# 注释别动',
  'title: "周会：第 3 期"',
  'tags: [会议, 读书]',
  'aliases:',
  '    - 例会',
  'date: 2026-09-20   # 开会那天',
  'done: false',
  'author:',
  '  name: 张三',
  '---',
  '',
  '# 正文标题',
  '',
  '一段话。',
].join('\n');

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; localStorage.clear(); });

const open = (md = MD) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: editorExtensions, content: markdownToHtml(md) });
  registerSource(editor, md);
  return host;
};
const saved = () => serializeDoc(editor!).markdown;
const row = (host: HTMLElement, key: string) => Array.from(host.querySelectorAll<HTMLElement>('.frontmatter-card__row')).find((r) => r.querySelector('.frontmatter-card__key')?.textContent === key)!;
const type = (input: HTMLInputElement, value: string, keyName = 'Enter') => { input.focus(); input.value = value; input.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true })); };

describe('属性卡片', () => {
  it('每个字段按类型给控件：文本框、列表芯片、日期、勾选；嵌套对象只读', () => {
    const host = open();
    expect((row(host, 'title').querySelector('input') as HTMLInputElement).value).toBe('周会：第 3 期');
    expect(Array.from(row(host, 'tags').querySelectorAll('.frontmatter-card__chip')).map((c) => c.firstChild?.textContent)).toEqual(['会议', '读书']);
    expect((row(host, 'date').querySelector('input') as HTMLInputElement).type).toBe('date');
    expect((row(host, 'done').querySelector('input') as HTMLInputElement).type).toBe('checkbox');
    expect(row(host, 'author').querySelector('input')).toBeNull();
    expect(row(host, 'author').querySelector('.frontmatter-card__value--complex')?.textContent).toContain('name: 张三');
  });

  it('只是打开看：存盘内容和原文一字不差', () => {
    open();
    expect(saved()).toBe(MD);
  });

  it('改文本、勾选、日期：文件里只有那一行变了', () => {
    const host = open();
    type(row(host, 'title').querySelector('input')!, '新标题');
    expect(saved()).toBe(MD.replace('title: "周会：第 3 期"', 'title: "新标题"'));
    const box = row(host, 'done').querySelector('input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    type(row(host, 'date').querySelector('input')!, '2026-10-01');
    expect(saved()).toBe(MD.replace('title: "周会：第 3 期"', 'title: "新标题"').replace('done: false', 'done: true').replace('date: 2026-09-20   # 开会那天', 'date: 2026-10-01   # 开会那天'));
  });

  it('列表：回车加一项（带 # 的去掉 #、重复的不加），× 去掉一项；块列表的缩进照旧', () => {
    const host = open();
    type(row(host, 'tags').querySelector('.frontmatter-card__input--add')!, '#想法');
    type(row(host, 'tags').querySelector('.frontmatter-card__input--add')!, '会议');
    expect(saved()).toBe(MD.replace('tags: [会议, 读书]', 'tags: [会议, 读书, 想法]'));
    (row(host, 'tags').querySelector('.frontmatter-card__chip-x') as HTMLElement).click();
    type(row(host, 'aliases').querySelector('.frontmatter-card__input--add')!, 'Weekly Sync');
    expect(saved()).toBe(MD.replace('tags: [会议, 读书]', 'tags: [读书, 想法]').replace('    - 例会', '    - 例会\n    - Weekly Sync'));
  });

  it('Esc 放弃正在输入的内容，不改文件', () => {
    const host = open();
    type(row(host, 'title').querySelector('input')!, '不想要的', 'Escape');
    expect(saved()).toBe(MD);
  });

  it('加属性、改名、删属性', () => {
    const host = open();
    const name = host.querySelector<HTMLInputElement>('.frontmatter-card__row--add input')!;
    name.value = 'status';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(saved()).toBe(MD.replace('  name: 张三\n---', '  name: 张三\nstatus:\n---'));
    // 重名的加不进去
    const again = host.querySelector<HTMLInputElement>('.frontmatter-card__row--add input')!;
    again.value = 'Tags';
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(again.classList.contains('frontmatter-card__input--error')).toBe(true);
    // 改名
    row(host, 'status').querySelector('.frontmatter-card__key')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    type(row(host, 'title').parentElement!.querySelector<HTMLInputElement>('.frontmatter-card__input--key')!, '状态');
    expect(saved()).toContain('\n状态:\n---');
    // 删
    (row(host, '状态').querySelector('.frontmatter-card__remove') as HTMLElement).click();
    (row(host, 'aliases').querySelector('.frontmatter-card__remove') as HTMLElement).click();
    expect(saved()).toBe(MD.replace('aliases:\n    - 例会\n', ''));
  });

  it('双击属性名：只出现改名框，不会同时打开 YAML 原文编辑；改完界面上就是新名字', () => {
    // 回归：名字标签被换成输入框后，冒泡上去的事件目标已脱离 DOM，曾被误判成「在卡片空白处双击」
    const host = open();
    row(host, 'date').querySelector('.frontmatter-card__key')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.querySelector('.source-node__input')).toBeNull();
    type(host.querySelector<HTMLInputElement>('.frontmatter-card__input--key')!, '开会日期');
    expect(row(host, '开会日期')).toBeDefined();
    expect(row(host, 'date')).toBeUndefined();
    expect(saved()).toBe(MD.replace('date: 2026-09-20', '开会日期: 2026-09-20'));
  });

  it('卡片里的回车 / 退格不会漏到 window：侧边栏的「回车重命名、退格删文件」收不到；⌘S 照常放行', () => {
    const host = open();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(`${e.metaKey ? '⌘' : ''}${e.key}`);
    window.addEventListener('keydown', spy);
    const add = () => row(host, 'tags').querySelector<HTMLInputElement>('.frontmatter-card__input--add')!;
    type(add(), '想法');                                   // 回车：加一项，卡片重画，输入框被销毁
    add().dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));  // 空输入框里退格：去掉最后一项
    type(row(host, 'title').querySelector('input')!, 'x', 'Escape');
    add().dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));
    window.removeEventListener('keydown', spy);
    expect(seen).toEqual(['⌘s']);
    expect(saved()).toBe(MD);
  });

  it('把属性删光：整个属性块消失，正文不受影响', () => {
    const host = open('---\ntags: [a]\n---\n\n# 标题\n\n正文');
    (row(host, 'tags').querySelector('.frontmatter-card__remove') as HTMLElement).click();
    expect(saved()).toBe('# 标题\n\n正文');
  });

  it('控件上的事件不交给编辑器：在输入框里双击不会打开原文编辑', () => {
    const host = open();
    row(host, 'title').querySelector('input')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.querySelector('.source-node__input')).toBeNull();
    // 卡片空白处（标题栏）双击才进原文编辑
    host.querySelector('.frontmatter-card__head')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.querySelector('.source-node__input')).not.toBeNull();
  });
});
