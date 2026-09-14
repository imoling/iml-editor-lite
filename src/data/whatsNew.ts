import { formatVersion } from '../utils/version';

/** 配图键：对应 src/assets/whats-new/<key>.png，在 WhatsNewModal 里映射 */
export type WhatsNewImage = 'hero' | 'slash' | 'wiki' | 'search' | 'daily' | 'local';

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
        desc: '模型配置里选「本机模型」，编辑器自动安装 llama.cpp 运行时，并按你的机器推荐讯飞星火、面壁 MiniCPM、Qwen 的小模型。',
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
