import DOMPurify from 'dompurify';

/**
 * 渲染来自文件内容的 HTML 前先净化：Markdown 里的原生 HTML、SVG 块都可能带脚本或事件属性。
 * 保留编辑器与预览用到的 data-* 属性和 SVG（含滤镜）。
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_ATTR: ['data-code', 'data-type', 'data-checked', 'data-latex', 'data-height', 'data-mermaid-block', 'data-svg-block', 'data-wiki-link', 'data-wiki-embed', 'data-embed-label', 'target'],
    ADD_TAGS: ['mermaid-block', 'svg-block'],
  });
}

/** 只允许 SVG 内容（用于 SVG 块预览） */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
