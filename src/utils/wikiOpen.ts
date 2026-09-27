import { useAppStore, readLibraryDir } from '../stores/appStore';
import { resolveWikiTarget, parseWikiTarget, findHeadingIndex, noteBaseName, type LinkableNote } from '../shared/wikiLink';
import { extractHeadings } from './outline';
import { noteDirOf, joinNotePath } from './assetUrl';

/**
 * 点 [[链接]]：打开它指的那篇文档。
 * 不建索引，点的时候现找：先看当前文档所在的文件夹，再翻侧边栏打开的那个文件夹（含子文件夹）。
 * 只按文件名认（`[[周会]]` → 周会.md，`[[项目/周会]]` → …/项目/周会.md）；按标题、别名链接要读别的文档的内容，这里不做。
 */

/** 文件夹很大时只翻这么多：再多就不是「点一下」该等的时间了 */
const MAX_NOTES = 5000;
const MAX_DEPTH = 8;
const NOTE_EXTS = ['.md', '.markdown', '.mdown', '.mkd', '.txt'];

async function notesIn(dir: string): Promise<LinkableNote[]> {
  return ((await readLibraryDir(dir)) || []).filter((e) => !e.isDirectory).map((e) => ({ path: e.path, title: '' }));
}

/** 一层一层往下翻（近的先找到），到上限就停 */
async function notesUnder(root: string): Promise<LinkableNote[]> {
  const out: LinkableNote[] = [];
  let level = [root];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0 && out.length < MAX_NOTES; depth++) {
    const listed = await Promise.all(level.map((dir) => readLibraryDir(dir).catch(() => null)));
    const next: string[] = [];
    for (const entries of listed) {
      for (const entry of entries || []) {
        if (entry.isDirectory) next.push(entry.path);
        else out.push({ path: entry.path, title: '' });
      }
    }
    level = next;
  }
  return out.slice(0, MAX_NOTES);
}

/** `[[子文件夹/笔记]]`：没打开文件夹时，按相对当前文档的路径直接去找 */
async function directPath(dir: string, note: string): Promise<string | null> {
  for (const ext of NOTE_EXTS) {
    const candidate = joinNotePath(dir, `${note}${ext}`);
    if (await window.api.fs.exists(candidate)) return candidate;
  }
  return null;
}

/** 跳到小节 / 块；这篇里没有就返回 false */
function jumpTo(content: string, headings: string[], block: string | null): boolean {
  if (block) {
    useAppStore.setState({ navigationRequest: { blockId: block, timestamp: Date.now() } });
    return true;
  }
  if (headings.length === 0) return true;
  const all = extractHeadings(content);
  const index = findHeadingIndex(all, headings);
  if (index === -1) return false;
  useAppStore.getState().scrollToHeading(all[index]);
  return true;
}

async function createNote(dir: string, note: string): Promise<void> {
  const store = useAppStore.getState();
  const filePath = joinNotePath(dir, `${note}.md`);
  const parent = noteDirOf(filePath, '');
  if (parent && !(await window.api.fs.exists(parent))) await window.api.fs.mkdir(parent);
  if (!(await window.api.fs.exists(filePath))) {
    const result = await window.api.fs.writeFile(filePath, `# ${noteBaseName(filePath)}\n\n`);
    if (!result.success) {
      store.notify(`新建失败：${result.error || '写不进这个位置'}`);
      return;
    }
  }
  await store.refreshWorkspace();
  await store.openFileByPath(filePath);
}

export async function openWikiLink(target: string): Promise<void> {
  const store = useAppStore.getState();
  const { activeTabId, workspacePath, notify } = store;
  const currentDir = noteDirOf(activeTabId, '');
  const parsed = parseWikiTarget(target);
  const section = () => (parsed.block ? `^${parsed.block}` : parsed.headings.join(' › '));

  // [[#小节]]：就在这一篇里
  if (!parsed.note) {
    store.editorFlush?.();
    const content = useAppStore.getState().tabs.find((t) => t.id === activeTabId)?.content ?? '';
    if (!jumpTo(content, parsed.headings, parsed.block)) notify(`这篇文档里没有「${section()}」这一节`);
    return;
  }

  let resolved = currentDir ? resolveWikiTarget(await notesIn(currentDir), target, currentDir) : null;
  if (!resolved?.hit && workspacePath) resolved = resolveWikiTarget(await notesUnder(workspacePath), target, currentDir);
  let hitPath = resolved?.hit?.path ?? null;
  if (!hitPath && currentDir && /[/\\]/.test(parsed.note)) hitPath = await directPath(currentDir, parsed.note);

  if (!hitPath) {
    const dir = currentDir || workspacePath;
    if (!dir) {
      notify(`没找到「${parsed.note}」：先保存这篇文档，或者打开一个文件夹`);
      return;
    }
    // 往上跳出文件夹的写法（../）只找不建：点一下链接不该在别处生出文件来
    if (parsed.note.split(/[/\\]/).includes('..')) {
      notify(`没找到「${parsed.note}」`);
      return;
    }
    notify(`没找到「${parsed.note}」`, undefined, [{ label: '新建', run: () => { void createNote(dir, parsed.note); } }]);
    return;
  }

  await store.openFileByPath(hitPath);
  const headings = resolved?.hit ? resolved.headings : parsed.headings;
  const block = resolved?.hit ? resolved.block : parsed.block;
  if (headings.length === 0 && !block) return;
  // 等标签页切过去、编辑器换上新内容，再滚
  setTimeout(() => {
    const opened = useAppStore.getState().tabs.find((t) => t.id === hitPath);
    if (opened && !jumpTo(opened.content, headings, block)) notify(`「${noteBaseName(hitPath)}」里没有「${section()}」这一节`);
  }, 150);
}
