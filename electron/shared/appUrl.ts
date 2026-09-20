/**
 * `iml://…` 链接的解析。纯函数，主进程收到链接后用它判断要做什么。
 *
 * 这些链接可能来自任何地方（网页、别的应用、聊天里别人发来的），所以只做「打开 / 新建 / 追加一句话 / 搜索」
 * 这几件无害的事，不提供删除、覆盖、执行之类的动作；新建永远不覆盖已有文件，内容有长度上限。
 *
 *   iml://open?path=/绝对路径/笔记.md          打开一个文件（只认笔记扩展名）
 *   iml://open?name=周会%23本周                 按笔记名打开（和 [[周会#本周]] 一个解析规则，可带小节）
 *   iml://new?title=标题&content=正文           在笔记库里新建一篇并打开
 *   iml://daily                                 打开今天的日记
 *   iml://capture?text=一句话                   追加到今天的日记末尾（不把窗口带到前面）
 *   iml://search?q=关键词                       打开全库搜索
 */
export type AppUrlAction =
  | { action: 'open-path'; path: string }
  | { action: 'open-name'; name: string }
  | { action: 'new'; title: string; content: string }
  | { action: 'daily' }
  | { action: 'capture'; text: string }
  | { action: 'search'; query: string };

export const APP_URL_SCHEME = 'iml';
const NOTE_EXT_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
const MAX_CONTENT = 200 * 1024;
const MAX_CAPTURE = 10 * 1024;
const MAX_NAME = 300;

const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);

export function parseAppUrl(raw: string): AppUrlAction | null {
  let url: URL;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (url.protocol !== `${APP_URL_SCHEME}:`) return null;
  // iml://open?… 里 open 在 host 上；iml:open?… 这种写法落在 pathname 上，两种都认
  const verb = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase();
  const q = url.searchParams;
  switch (verb) {
    case 'open': {
      const path = q.get('path');
      if (path) return isAbsolute(path) && NOTE_EXT_RE.test(path) && !path.includes('\0') ? { action: 'open-path', path } : null;
      const name = (q.get('name') || q.get('file') || '').trim();
      return name && name.length <= MAX_NAME ? { action: 'open-name', name } : null;
    }
    case 'new': {
      const title = (q.get('title') || q.get('name') || '').trim().slice(0, MAX_NAME);
      const content = q.get('content') || '';
      if (!title && !content) return null;
      return content.length <= MAX_CONTENT ? { action: 'new', title, content } : null;
    }
    case 'daily':
      return { action: 'daily' };
    case 'capture': {
      const text = (q.get('text') || q.get('content') || '').trim();
      return text && text.length <= MAX_CAPTURE ? { action: 'capture', text } : null;
    }
    case 'search': {
      const query = (q.get('q') || q.get('query') || '').trim();
      return query ? { action: 'search', query: query.slice(0, MAX_NAME) } : null;
    }
    default:
      return null;
  }
}

/** 命令行参数里的第一个 iml:// 链接（Windows / Linux 上链接是作为启动参数传进来的） */
export const appUrlFromArgv = (argv: string[]) => argv.find((a) => a.toLowerCase().startsWith(`${APP_URL_SCHEME}:`)) ?? null;
