import { describe, it, expect } from 'vitest';
import { deriveNoteTitle } from './noteTitle';

describe('deriveNoteTitle', () => {
  it('取第一行正文，去掉标题井号与格式符号', () => {
    expect(deriveNoteTitle('# 周报\n\n内容')).toBe('周报');
    expect(deriveNoteTitle('\n\n**大模型**是指…')).toBe('大模型是指…');
    expect(deriveNoteTitle('- [ ] 买牛奶\n- [x] 遛狗')).toBe('买牛奶');
    expect(deriveNoteTitle('> 引用的一句话')).toBe('引用的一句话');
    expect(deriveNoteTitle('1. 第一步')).toBe('第一步');
    // 富文本模式下输入的「# 周会纪要」会被转义成 \\# 存盘
    expect(deriveNoteTitle('\\# 周会纪要')).toBe('周会纪要');
    expect(deriveNoteTitle('\\*不是列表\\*')).toBe('不是列表');
  });

  it('链接与图片只保留文字', () => {
    expect(deriveNoteTitle('[官网](https://example.com) 说明')).toBe('官网 说明');
    expect(deriveNoteTitle('![封面](a.png) 旅行')).toBe('封面 旅行');
    expect(deriveNoteTitle('[[项目计划|计划]] 摘要')).toBe('计划 摘要');
  });

  it('公式、围栏、分隔线、表格分隔行不能当标题', () => {
    expect(deriveNoteTitle('$$\n\n$$\n\n正文在这里')).toBe('正文在这里');
    expect(deriveNoteTitle('---\n\n第一段')).toBe('第一段');
    expect(deriveNoteTitle('```js\nconsole.log(1)\n```')).toBe('console.log(1)');
    expect(deriveNoteTitle('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a b');
  });

  it('空文档或只有符号时返回 null', () => {
    expect(deriveNoteTitle('')).toBeNull();
    expect(deriveNoteTitle('\n  \n')).toBeNull();
    expect(deriveNoteTitle('$$')).toBeNull();
    expect(deriveNoteTitle('***\n---')).toBeNull();
    expect(deriveNoteTitle('****')).toBeNull();
  });

  it('去掉文件名非法字符并截断到 30 个字符', () => {
    expect(deriveNoteTitle('a/b:c*d?e"f|g')).toBe('abcdefg');
    // 尖括号按 HTML 标签整体去掉
    expect(deriveNoteTitle('标题 <br> 后面')).toBe('标题 后面');
    const long = '大模型是指具有大规模参数（如数十亿甚至万亿参数）的神经网络模型，其训练过程使用海量数据';
    expect(deriveNoteTitle(long)).toBe(long.slice(0, 30));
    expect(deriveNoteTitle('结尾的句点...')).toBe('结尾的句点');
  });
});
