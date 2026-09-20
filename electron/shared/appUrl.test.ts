import { describe, expect, it } from 'vitest';
import { parseAppUrl, appUrlFromArgv } from './appUrl';

describe('iml:// 链接', () => {
  it('打开：绝对路径的笔记文件，或按名字（可带小节，中文要编码也行、不编码也行）', () => {
    expect(parseAppUrl('iml://open?path=/Users/me/笔记/周会.md')).toEqual({ action: 'open-path', path: '/Users/me/笔记/周会.md' });
    expect(parseAppUrl('iml://open?path=C%3A%5Cnotes%5Ca.md')).toEqual({ action: 'open-path', path: 'C:\\notes\\a.md' });
    expect(parseAppUrl('iml://open?name=%E5%91%A8%E4%BC%9A%23%E6%9C%AC%E5%91%A8')).toEqual({ action: 'open-name', name: '周会#本周' });
    expect(parseAppUrl('iml://open?name=周会')).toEqual({ action: 'open-name', name: '周会' });
  });

  it('新建、日记、追加一句、搜索', () => {
    expect(parseAppUrl('iml://new?title=想法&content=%23%20标题%0A正文')).toEqual({ action: 'new', title: '想法', content: '# 标题\n正文' });
    expect(parseAppUrl('iml://new?content=只有正文')).toEqual({ action: 'new', title: '', content: '只有正文' });
    expect(parseAppUrl('iml://daily')).toEqual({ action: 'daily' });
    expect(parseAppUrl('IML://Daily/')).toEqual({ action: 'daily' });
    expect(parseAppUrl('iml://capture?text=给客户回邮件')).toEqual({ action: 'capture', text: '给客户回邮件' });
    expect(parseAppUrl('iml://search?q=周会 纪要')).toEqual({ action: 'search', query: '周会 纪要' });
  });

  it('不认的一律返回 null：别的协议、不存在的动作、相对路径、不是笔记的文件、空参数、超长内容', () => {
    const bad = [
      'https://open?path=/a.md', 'file:///etc/passwd', 'iml://delete?path=/a.md', 'iml://exec?cmd=rm', 'iml://',
      'iml://open', 'iml://open?path=../../etc/passwd', 'iml://open?path=notes/a.md', 'iml://open?path=/etc/passwd', 'iml://open?path=/Users/me/run.sh',
      'iml://open?path=/a.md%00.sh', 'iml://new', 'iml://capture?text=%20%20', 'iml://search?q=', '不是链接', '',
      `iml://new?content=${'x'.repeat(200 * 1024 + 1)}`, `iml://capture?text=${'x'.repeat(10 * 1024 + 1)}`,
    ];
    for (const u of bad) expect(`${u.slice(0, 40)} → ${JSON.stringify(parseAppUrl(u))}`).toBe(`${u.slice(0, 40)} → null`);
  });

  it('从启动参数里挑出链接', () => {
    expect(appUrlFromArgv(['C:\\app.exe', '--flag', 'iml://daily'])).toBe('iml://daily');
    expect(appUrlFromArgv(['/path/app', '/Users/me/a.md'])).toBeNull();
  });
});
