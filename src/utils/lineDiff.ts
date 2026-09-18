export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

const MAX_CELLS = 4_000_000;

/**
 * 行级 diff（旧 → 新）。先剥掉相同的头尾，中间部分用 LCS；
 * 中间部分大到 DP 表放不下时退化成「整段删除 + 整段新增」，不为了一次对比吃掉几百 MB 内存。
 */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const head: DiffOp[] = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let mid: DiffOp[];
  if (midA.length * midB.length > MAX_CELLS) {
    mid = [...midA.map((text): DiffOp => ({ type: 'del', text })), ...midB.map((text): DiffOp => ({ type: 'add', text }))];
  } else {
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] = midA[i] === midB[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { mid.push({ type: 'same', text: midA[i] }); i++; j++; }
      else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) mid.push({ type: 'del', text: midA[i++] });
      else mid.push({ type: 'add', text: midB[j++] });
    }
    while (i < n) mid.push({ type: 'del', text: midA[i++] });
    while (j < m) mid.push({ type: 'add', text: midB[j++] });
  }
  return [...head, ...mid, ...tail];
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'del') removed++;
  }
  return { added, removed };
}

export type DiffRow = DiffOp | { type: 'gap'; count: number };

/** 只保留改动附近的上下文，长段的未改动内容折叠成一行「… N 行未改动」 */
export function collapseContext(ops: DiffOp[], context = 3): DiffRow[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, i) => {
    if (op.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const rows: DiffRow[] = [];
  let gap = 0;
  ops.forEach((op, i) => {
    if (keep[i]) {
      if (gap) { rows.push({ type: 'gap', count: gap }); gap = 0; }
      rows.push(op);
    } else gap++;
  });
  if (gap) rows.push({ type: 'gap', count: gap });
  return rows;
}
