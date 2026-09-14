import { formatDate, formatTime, formatWeekday } from './date';

/** 笔记库里的约定目录 */
export const DAILY_DIR = '日记';
export const TEMPLATE_DIR = '模板';

export interface TemplateVars {
  title?: string;
  date?: Date;
}

/** 模板变量：{{title}} {{date}} {{time}} {{datetime}} {{weekday}} {{year}} {{month}} {{day}} */
export function renderNoteTemplate(template: string, vars: TemplateVars = {}): string {
  const d = vars.date ?? new Date();
  const map: Record<string, string> = {
    title: vars.title ?? '',
    date: formatDate(d),
    time: formatTime(d),
    datetime: `${formatDate(d)} ${formatTime(d)}`,
    weekday: formatWeekday(d),
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, '0'),
    day: String(d.getDate()).padStart(2, '0'),
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key in map ? map[key] : m));
}

export const DEFAULT_DAILY_TEMPLATE = `# {{date}} {{weekday}}

## 今天

- 

## 想法

`;

/** 首次使用时写入笔记库「模板」目录的示例模板 */
export const SAMPLE_TEMPLATES: { name: string; content: string }[] = [
  { name: '日记', content: DEFAULT_DAILY_TEMPLATE },
  {
    name: '会议记录',
    content: `# {{title}}

- 时间：{{datetime}}
- 参会：
- 主持：

## 议题

1. 

## 结论

- 

## 待办

- [ ] 
`,
  },
  {
    name: '读书笔记',
    content: `# {{title}}

- 书名：
- 作者：
- 开始阅读：{{date}}

## 一句话总结

## 摘录

> 

## 我的想法

`,
  },
  {
    name: '周计划',
    content: `# {{title}}

> 本周开始于 {{date}}（{{weekday}}）

## 本周目标

- [ ] 
- [ ] 
- [ ] 

## 每日

### 周一
### 周二
### 周三
### 周四
### 周五

## 周末回顾

`,
  },
];
