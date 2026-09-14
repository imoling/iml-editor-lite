/**
 * 版本号采用「年份 + 小版本」方案（类似 Apple：26.1、26.2 …）。
 * npm / electron-builder 要求三段式，所以 package.json 里写 26.1.0，界面上展示时省略末尾的 .0。
 */
export function formatVersion(v: string | undefined | null): string {
  if (!v) return '';
  const parts = v.split('.');
  if (parts.length === 3 && parts[2] === '0') return `${parts[0]}.${parts[1]}`;
  return v;
}

/** 逐段比较版本号，只有远端确实更新时才提示（避免 1.9.0 与 26.1.0 这类字符串不等就误报） */
export function isNewerVersion(latest: string | undefined | null, current: string | undefined | null): boolean {
  if (!latest || !current) return false;
  const a = latest.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
