/** 日期格式化的纯函数：主进程（快速捕获要建日记）与渲染进程共用。 */
const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const formatTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const formatWeekday = (d: Date) => WEEKDAYS[d.getDay()];
