import { fillEmbeds } from './noteEmbed';

const ASSET_PREFIX = 'iml-asset://local/';

/**
 * 导出前把 `![[嵌入]]` 展开成真正的内容：不然导出的 PDF / HTML 里只有一行 `![[周会#本周]]` 原文。
 * 编辑器里图片走的是 iml-asset:// 协议，导出的文件离开了应用就认不得它，这里换回绝对路径——
 * 导出管线本来就认绝对路径（PDF 直接读，单文件 HTML 会读进来内联）。
 * 被嵌入笔记里的流程图不会渲染（只有正文里的会），显示成代码。
 */
export async function expandEmbedsForExport(html: string, fromPath: string | null): Promise<string> {
  if (!html.includes('data-wiki-embed')) return html;
  const box = document.createElement('div');
  box.innerHTML = html;
  await fillEmbeds(box, fromPath && !fromPath.startsWith('new-') ? fromPath : null);

  box.querySelectorAll<HTMLElement>('img[src], source[src]').forEach((el) => {
    const src = el.getAttribute('src') || '';
    if (src.startsWith(ASSET_PREFIX)) { try { el.setAttribute('src', decodeURIComponent(src.slice(ASSET_PREFIX.length))); } catch { /* 地址不合法就原样留着 */ } }
  });
  // 录音在纸面上放不了：留一行文字说明这里有什么
  box.querySelectorAll<HTMLElement>('[data-embed-kind="audio"]').forEach((slot) => {
    const name = decodeURIComponent((slot.querySelector('audio')?.getAttribute('src') || '').split('/').pop() || '').split(/[/\\]/).pop() || slot.getAttribute('data-wiki-embed') || '';
    slot.textContent = `🎙 录音：${name}`;
  });
  // 视频同理；PDF 卡片上的按钮在导出的文件里没用，只留文件名
  box.querySelectorAll<HTMLElement>('[data-embed-kind="video"]').forEach((slot) => {
    const name = decodeURIComponent((slot.querySelector('video')?.getAttribute('src') || '').split('/').pop() || '').split(/[/\\]/).pop() || slot.getAttribute('data-wiki-embed') || '';
    slot.textContent = `🎞 视频：${name}`;
  });
  box.querySelectorAll<HTMLElement>('[data-embed-kind="file"]').forEach((slot) => { slot.textContent = `📄 ${slot.querySelector('.note-embed__file-name')?.textContent || slot.getAttribute('data-wiki-embed') || ''}`; });
  // 导出的文件里点不了：标题栏只留文字，去掉交互用的属性和加载过程的标记
  box.querySelectorAll<HTMLElement>('[data-wiki-embed]').forEach((slot) => { slot.removeAttribute('data-embed-token'); slot.classList.remove('note-embed--loading'); });
  box.querySelectorAll<HTMLElement>('.note-embed__head').forEach((head) => head.removeAttribute('data-wiki-link'));
  return box.innerHTML;
}
