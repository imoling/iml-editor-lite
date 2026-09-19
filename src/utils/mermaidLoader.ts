type Mermaid = typeof import('mermaid').default;

let loading: Promise<Mermaid> | null = null;

/**
 * Mermaid 连同它的依赖是整个应用里最大的一块，而大多数笔记里根本没有流程图。
 * 不放进启动要加载的主包：第一次真的要画图时才加载，之后复用同一份
 */
export function loadMermaid(): Promise<Mermaid> {
  return (loading ??= import('mermaid').then((m) => m.default));
}
