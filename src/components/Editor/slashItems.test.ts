import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from './editorExtensions';
import { createSlashItems, filterSlashItems } from './slashItems';

const actions = { openTable: vi.fn(), openImage: vi.fn(), openLink: vi.fn(), openAI: vi.fn() };

describe('slash items', () => {
  it('按标题和关键词过滤，支持拼音首字母', () => {
    const items = createSlashItems(actions);
    expect(filterSlashItems(items, '').length).toBe(items.length);
    expect(filterSlashItems(items, '表格').map((i) => i.id)).toEqual(['table']);
    expect(filterSlashItems(items, 'bg').map((i) => i.id)).toEqual(['table']);
    expect(filterSlashItems(items, 'h').map((i) => i.id)).toEqual(['h1', 'h2', 'h3', 'divider']);
    expect(filterSlashItems(items, 'zzz')).toEqual([]);
  });

  it('执行命令会先删掉触发文本，再转换成对应节点', () => {
    const editor = new Editor({ extensions: editorExtensions, content: '<p>/h1</p>' });
    const items = createSlashItems(actions);
    const range = { from: 1, to: 4 };
    items.find((i) => i.id === 'h1')!.run(editor, range);
    expect(editor.getHTML()).toBe('<h1></h1>');
    editor.commands.setContent('<p>/table</p>');
    items.find((i) => i.id === 'table')!.run(editor, { from: 1, to: 7 });
    expect(actions.openTable).toHaveBeenCalled();
    expect(editor.getHTML()).toBe('<p></p>');
    editor.destroy();
  });
});
