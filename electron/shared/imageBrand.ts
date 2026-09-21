/**
 * 长图底部的出处角标：「来自 iML 编辑器」。纯函数。
 *
 * 分成几张的长图每一张都要带（别人转发时可能只转其中一张），所以角标单独画一条、拼到每张图的末尾。
 */
export const BRAND_TEXT = '来自 iML 编辑器';

export const BRAND_CSS = `
  .export-brand { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 44px; padding-top: 18px; border-top: 1px solid #eceef1; color: #9aa1ab; font-size: 13px; line-height: 20px; }
  .export-brand img { width: 20px; height: 20px; border-radius: 5px; }
`;

/** 角标的 HTML；logo 传 data: 地址，没有就只放文字 */
export function brandFooterHtml(logoDataUrl: string | null): string {
  const logo = logoDataUrl ? `<img src="${logoDataUrl}" alt="">` : '';
  return `<footer class="export-brand">${logo}<span>${BRAND_TEXT}</span></footer>`;
}

/**
 * 角标那一条在截图里的位置。footerTop 是角标顶端在文档里的高度（含它上面的留白），docHeight 是整个文档的高度：
 * 从角标顶到文档底（含页面底部的留白）整段作为一条，拼到每张图末尾时和最后一张原生的样子一致。
 */
export function brandBand(docHeight: number, footerTop: number): { top: number; height: number } {
  const top = Math.max(0, Math.min(footerTop, docHeight));
  return { top, height: Math.max(0, docHeight - top) };
}
