/**
 * 导出（PDF / HTML / 打印）共用的样式与文档外壳：与应用内预览保持同一套语义（提示块、目录、标签、属性卡片、脚注）。
 * 纯字符串，不依赖 Node：Electron 主进程用它拼导出文件，Tauri 壳的前端适配层用它拼打印内容。
 */

/** root 是正文容器的选择器：独立的导出文件里就是 body；塞进应用页面里打印时换成一个专用的容器，免得和界面样式打架 */
export function exportCss(root = 'body'): string {
  return `
  ${root} { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #333; line-height: 1.7; max-width: 860px; margin: 0 auto; }
  img { max-width: 100%; border-radius: 8px; margin: 10px 0; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
  code { font-family: 'Menlo', 'Monaco', monospace; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; margin: 20px 0; }
  th, td { border: 1px solid #ddd; padding: 10px 12px; text-align: left; }
  th { background-color: #f8f9fa; }
  h1, h2, h3 { color: #111; margin-top: 1.5em; }
  blockquote { margin: 1em 0; padding: 2px 16px; border-left: 3px solid #d0d7de; color: #57606a; }
  mark { background: #fff3a3; padding: 0 2px; border-radius: 2px; }
  kbd { font: 0.85em Menlo, monospace; padding: 1px 5px; border: 1px solid #d0d7de; border-bottom-width: 2px; border-radius: 4px; background: #f6f8fa; }
  .callout { margin: 1em 0; padding: 10px 14px; border-radius: 8px; border-left: 4px solid #6366f1; background: #eef2ff; break-inside: avoid; }
  .callout__title { font-weight: 600; margin-bottom: 4px; color: #4338ca; }
  .callout__body > :first-child { margin-top: 0; } .callout__body > :last-child { margin-bottom: 0; }
  .callout--tip { border-color: #10b981; background: #ecfdf5; } .callout--tip .callout__title { color: #047857; }
  .callout--important { border-color: #8b5cf6; background: #f5f3ff; } .callout--important .callout__title { color: #6d28d9; }
  .callout--warning { border-color: #f59e0b; background: #fffbeb; } .callout--warning .callout__title { color: #b45309; }
  .callout--caution { border-color: #ef4444; background: #fef2f2; } .callout--caution .callout__title { color: #b91c1c; }
  .toc-block { margin: 1em 0; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
  .toc-block__item { display: block; color: #4f46e5; text-decoration: none; line-height: 1.9; }
  .tag-chip { color: #4f46e5; background: #eef2ff; border-radius: 10px; padding: 0 7px; font-size: 0.92em; }
  .wiki-link { color: #4f46e5; }
  .frontmatter-card { margin: 0 0 1.5em; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 0.9em; color: #57606a; }
  .frontmatter-card__row { display: flex; gap: 12px; line-height: 1.9; } .frontmatter-card__key { min-width: 80px; color: #8b949e; }
  .frontmatter-card__chip { display: inline-block; margin-right: 6px; padding: 0 8px; border-radius: 10px; background: #f0f2f5; }
  .footnotes { margin-top: 2em; padding-top: 0.8em; border-top: 1px solid #e5e7eb; font-size: 0.9em; color: #57606a; }
  .footnote-ref { color: #4f46e5; }
  .math-block { text-align: center; margin: 1em 0; }
  .note-embed { margin: 1em 0; padding: 2px 0 2px 14px; border-left: 3px solid #c7d2fe; }
  .note-embed[data-embed-kind="image"] { border-left: none; padding-left: 0; }
  .note-embed__head { font-size: 0.85em; font-weight: 600; color: #4f46e5; margin-bottom: 2px; }
  .note-embed__hint { font-size: 0.85em; color: #8b949e; font-style: italic; }
  .note-embed__body h1 { font-size: 1.35em; } .note-embed__body h2 { font-size: 1.2em; }
`;
}

export const EXPORT_CSS = exportCss();

export const exportDocument = (htmlContent: string, title: string, baseHref?: string) => `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>${title.replace(/[<>&]/g, '')}</title>
    ${baseHref ? `<base href="${baseHref}">` : ''}
    <style>${EXPORT_CSS}</style>
  </head>
  <body>${htmlContent}</body>
</html>`;
