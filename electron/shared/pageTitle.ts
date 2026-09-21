/** 从一段 HTML 里读出网页标题、判断编码。纯函数：Electron 主进程和 Tauri 壳的前端适配层共用这一份 */

const decodeEntities = (s: string) =>
  s.replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

/** 从 HTML 里取标题：<title> 优先，其次 og:title */
export function extractHtmlTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    ?? /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1]
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  if (!title) return null;
  const clean = decodeEntities(title).replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 140) : null;
}

/** Content-Type 或 <meta charset> 里声明的编码（不少中文站还是 GBK） */
export function detectCharset(contentType: string, head: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const name = (fromHeader || fromMeta || 'utf-8').toLowerCase();
  return name === 'gb2312' ? 'gbk' : name;
}
