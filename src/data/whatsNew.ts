import { formatVersion } from '../utils/version';

/** 配图键：对应 src/assets/whats-new/<key>.png，在 WhatsNewModal 里映射 */
export type WhatsNewImage =
  | 'hero' | 'slash' | 'wiki' | 'search' | 'daily' | 'local'
  | 'v262-hero' | 'v262-source' | 'v262-compat' | 'v262-paste' | 'v262-history' | 'v262-semantic' | 'v262-focus';

export interface WhatsNewPage {
  key: string;
  /** 标题上方的小字，如「记笔记」 */
  kicker: string;
  title: string;
  desc: string;
  /** 快捷键或触发方式 */
  hint?: string;
  bullets?: string[];
  image: WhatsNewImage;
}

export interface WhatsNewEntry {
  /** 展示用版本号（年份.小版本），与 formatVersion(app 版本) 对齐 */
  version: string;
  title: string;
  pages: WhatsNewPage[];
  /** 这一版拿掉的东西，给老用户一个交代（显示在最后一页） */
  removed?: string;
  releaseUrl: string;
}

/** 每个大版本一条；新版本加在最前面 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '26.2',
    title: '放心把笔记搬进来',
    releaseUrl: 'https://github.com/imoling/iml-markdown-editor/releases/tag/v26.2.0',
    pages: [
      {
        key: 'intro', kicker: '新特性', title: '放心把笔记搬进来',
        desc: '这一版只做一件事：让你敢把 Obsidian、Typora、GitHub 里的笔记直接搬过来用 —— 写法都认得，文件不会被改花，改错了能找回来。',
        bullets: ['没编辑过的内容，保存时一个字符都不动', '属性、提示块、#标签、[TOC]、脚注、行内公式都认得', '版本历史、图片压缩与清理、本机语义索引'],
        image: 'v262-hero',
      },
      {
        key: 'fidelity', kicker: '保真', title: '改一个字，只变一个字',
        desc: '富文本模式保存时，没碰过的段落直接写回文件里的原文：表格的对齐、列表用 * 还是 -、标题后空不空行、文件末尾的换行，全都保持原样。',
        bullets: ['my_var 不再变成 my\\_var，[1] 不再变成 \\[1\\]', '删除线、<kbd>、<details>、HTML 注释、脚注不再丢失', '放进 Git 验证：git diff 里只有你改的那一行'],
        image: 'v262-source',
      },
      {
        key: 'compat', kicker: '兼容', title: '属性、提示块、标签、目录', hint: '/',
        desc: '文档开头的 YAML 显示成属性卡片；> [!NOTE] 渲染成彩色提示块；#标签 自动汇总到侧边栏的标签视图；[TOC] 生成随标题更新的目录。',
        bullets: ['斜杠菜单新增：提示块、警告块、目录、属性', '行内公式 $E=mc^2$ 直接渲染，单击修改', '侧边栏「标签」页：层级标签、按标签筛笔记'],
        image: 'v262-compat',
      },
      {
        key: 'paste', kicker: '粘贴与图片', title: '截图不再是几 MB 的负担',
        desc: '粘贴或拖入的图片自动压缩成 WebP，存到笔记旁的 assets/ 并用时间戳命名；相对路径的图片现在能在编辑器里正常显示了。',
        bullets: ['粘贴网址自动取网页标题，变成 [标题](网址)', '源码模式粘贴网页内容，自动转成 Markdown', '视图 → 清理未引用的图片：移入废纸篓，可恢复'],
        image: 'v262-paste',
      },
      {
        key: 'history', kicker: '后悔药', title: '版本历史', hint: '⇧⌘H',
        desc: '每次保存都在本机留一个版本，逐行对比、一键恢复。别的编辑器或同步盘写进来的内容，在被覆盖前也会先留一份。',
        bullets: ['历史放在应用数据里，不污染笔记库和 Git 仓库', '连续的自动保存合并成一个版本，保留最近 60 天', '恢复本身也进历史，随时可以再撤回'],
        image: 'v262-history',
      },
      {
        key: 'semantic', kicker: '轻量 AI', title: '相关笔记与语义搜索',
        desc: '一个 26 MB 的本机嵌入模型读懂每篇笔记的意思：目录面板推荐「相关笔记」，搜索时用词不一样也能找到。和本机模型共用运行时，全程不出这台电脑。',
        bullets: ['智能 → 相关笔记：一键开启，笔记改动后自动增量更新', '可选 BGE-small / BGE-base / Qwen3-Embedding', '状态栏始终显示 AI 请求发往本机还是云端；设置里可一键关闭全部 AI'],
        image: 'v262-semantic',
      },
      {
        key: 'more', kicker: '还有这些', title: '写得更专心', hint: '⇧⌘.',
        desc: '专注模式收起侧边栏和工具栏，当前段落以外的内容淡出，光标所在行保持在屏幕中间。',
        bullets: ['设置 → 正文排版：字体、字号、行距、页面宽度', '源码模式左右滚动同步；预览里的任务列表有勾选框了', '导出单文件 HTML（图片内联）；PDF 里的本地图片和公式能正常显示了', '失焦自动保存不再改写没动过的文件'],
        image: 'v262-focus',
      },
    ],
  },
  {
    version: '26.1',
    title: '回归纯粹编辑器',
    releaseUrl: 'https://github.com/imoling/iml-markdown-editor/releases/tag/v26.1.0',
    removed: '公众号写作工作站、联网搜索与微信发布已整体移除。需要的话可以继续使用 v1.9.0 发布包，代码保留在 backup/v1.9.0-before-rewrite-20260913 分支。',
    pages: [
      {
        key: 'intro', kicker: '新特性', title: '回归纯粹编辑器',
        desc: '版本号从这一版起改为「年份.小版本」。这次更新围绕两件事：把笔记记得更顺手，把 AI 留在本机。',
        bullets: ['斜杠菜单、双向链接、全文搜索、每日日记', '本机模型：编辑器自己托管的离线 AI', '配置改为浮层，Dock 里只有一个窗口'],
        image: 'hero',
      },
      {
        key: 'slash', kicker: '记笔记', title: '斜杠插入菜单', hint: '/',
        desc: '空行输入 / ，标题、列表、任务、表格、代码块、公式、流程图、日期都在一个菜单里，继续输入即可筛选。',
        image: 'slash',
      },
      {
        key: 'wiki', kicker: '记笔记', title: '双向链接', hint: '[[',
        desc: '输入 [[ 弹出笔记候选，回车插入链接，点击直达；不存在的笔记会在当前目录里自动创建。',
        bullets: ['目录面板底部显示「反向链接」：谁引用了这篇', '源码模式同样支持 [[ 补全'],
        image: 'wiki',
      },
      {
        key: 'search', kicker: '记笔记', title: '全文搜索', hint: '⌘⇧F',
        desc: '搜整个笔记库，多个关键词按「都包含」匹配，命中片段高亮；回车打开笔记并定位到第一处。',
        image: 'search',
      },
      {
        key: 'daily', kicker: '记笔记', title: '每日日记与模板', hint: '⌘⇧D',
        desc: '一键打开今日日记，不存在就按模板新建。把笔记放进「模板」文件夹，新建时就能从模板开始。',
        bullets: ['模板支持 {{title}} {{date}} 等变量', '日记按日期归档在「日记」文件夹'],
        image: 'daily',
      },
      {
        key: 'local', kicker: '轻量 AI', title: '本机模型，零配置离线 AI', hint: '⌘⇧M',
        desc: '「智能 → 写作助手」里选「本机模型」，编辑器自动安装 llama.cpp 运行时，并按你的机器推荐讯飞星火、面壁 MiniCPM、Qwen 的小模型。',
        bullets: ['下载支持断点续传与 SHA256 校验', '请求只发往 127.0.0.1，笔记不出这台电脑', '也可导入自己的 GGUF 文件'],
        image: 'local',
      },
      {
        key: 'more', kicker: '还有这些', title: '更安静，也更顺手',
        desc: '一些不那么显眼、但每天都会用到的改动。',
        bullets: ['笔记库即工作区：可放进 iCloud Drive 多设备共用，外部改动自动刷新', '配置、关于、快捷键改为主窗口内的浮层', 'AI 气泡保持不变：空行按空格续写、画流程图；选中文字润色、总结、扩写', '查找替换、⌘K 插入链接、⌘P 导出 PDF、侧边栏拖拽调宽'],
        image: 'hero',
      },
    ],
  },
];

/** 当前版本对应的新特性条目；没有为这一版写介绍时返回 null */
export function latestWhatsNew(currentVersion: string, entries: WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry | null {
  const v = formatVersion(currentVersion);
  return entries.find((e) => e.version === v) ?? null;
}

/**
 * 新安装（没记录过）或升级到有介绍的新版本时展示；同一大版本的小修订不重复弹。
 */
export function shouldShowWhatsNew(currentVersion: string, lastSeenVersion: string | null | undefined, entries: WhatsNewEntry[] = WHATS_NEW): boolean {
  const entry = latestWhatsNew(currentVersion, entries);
  if (!entry) return false;
  if (!lastSeenVersion) return true;
  return formatVersion(lastSeenVersion) !== entry.version;
}
