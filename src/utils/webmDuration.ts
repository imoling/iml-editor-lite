/**
 * 给 MediaRecorder 录出来的 WebM 补上时长。
 *
 * 浏览器边录边写，文件头里的 Info 段没有 Duration —— 播放器拿到这种文件会显示「时长未知」，进度条也拖不了。
 * 我们自己知道录了多久，把 Duration 写回去就行：Info 段在文件最前面几百个字节里，
 * 外层 Segment 的长度是「未知」（流式写法），所以改 Info 的长度不牵连别处。
 * 结构不是预期的样子（不是 WebM、Segment 长度已知、已经有 Duration……）就原样返回，宁可不补也不能把文件改坏。
 */

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

interface Vint { value: number; length: number; unknown: boolean }

/** 元素 ID：带着长度标记位一起读（1A45DFA3 这种写法就是带标记的） */
function readId(buf: Uint8Array, pos: number): { id: number; length: number } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i];
  return { id, length };
}

/** 元素长度：去掉长度标记位；全 1 表示「未知长度」 */
function readSize(buf: Uint8Array, pos: number): Vint | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let unknown = value === (0xff >> length);
  for (let i = 1; i < length; i++) { value = value * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) unknown = false; }
  return { value, length, unknown };
}

/** 长度一律写成 8 字节的形式（01 xx xx xx xx xx xx xx）：合法，且不用算最短编码 */
function writeSize8(size: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let rest = size;
  for (let i = 7; i >= 1; i--) { out[i] = rest % 256; rest = Math.floor(rest / 256); }
  return out;
}

export interface PatchedHead {
  /** 替换掉原文件开头 consumed 个字节的新内容 */
  head: Uint8Array;
  consumed: number;
}

/**
 * prefix：文件开头的一段（几 KB 足够，Info 必须完整落在里面）。返回 null = 没法补，调用方用原文件。
 */
export function patchWebmDuration(prefix: Uint8Array, durationMs: number): PatchedHead | null {
  if (!(durationMs > 0)) return null;
  let pos = 0;
  const ebml = readId(prefix, pos);
  if (!ebml || ebml.id !== ID_EBML) return null;
  const ebmlSize = readSize(prefix, pos + ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  pos += ebml.length + ebmlSize.length + ebmlSize.value;

  const segment = readId(prefix, pos);
  if (!segment || segment.id !== ID_SEGMENT) return null;
  const segmentSize = readSize(prefix, pos + segment.length);
  // Segment 长度已知的话，往里加字节就得连它一起改；MediaRecorder 不会这么写，遇到了就不碰
  if (!segmentSize || !segmentSize.unknown) return null;
  pos += segment.length + segmentSize.length;

  // Segment 里第一层：找 Info（前面可能有 SeekHead / Void）
  while (pos < prefix.length) {
    const el = readId(prefix, pos);
    if (!el) return null;
    const size = readSize(prefix, pos + el.length);
    if (!size || size.unknown) return null;
    const bodyStart = pos + el.length + size.length;
    const bodyEnd = bodyStart + size.value;
    if (el.id !== ID_INFO) { pos = bodyEnd; continue; }
    if (bodyEnd > prefix.length) return null;

    // 时长的单位由 TimecodeScale 定（纳秒 / 单位），默认 1,000,000 即毫秒
    let scale = 1_000_000;
    for (let p = bodyStart; p < bodyEnd;) {
      const child = readId(prefix, p);
      const childSize = child && readSize(prefix, p + child.length);
      if (!child || !childSize || childSize.unknown) return null;
      const valueStart = p + child.length + childSize.length;
      if (child.id === ID_DURATION) return null;   // 已经有了
      if (child.id === ID_TIMECODE_SCALE) { scale = 0; for (let i = 0; i < childSize.value; i++) scale = scale * 256 + prefix[valueStart + i]; }
      p = valueStart + childSize.value;
    }
    if (!(scale > 0)) return null;

    const duration = new Uint8Array(2 + 1 + 8);
    duration.set([0x44, 0x89, 0x88]);                                   // ID + 长度 8
    new DataView(duration.buffer).setFloat64(3, (durationMs * 1_000_000) / scale);
    const body = prefix.subarray(bodyStart, bodyEnd);
    const newSize = writeSize8(body.length + duration.length);
    const head = new Uint8Array(pos + el.length + newSize.length + body.length + duration.length);
    head.set(prefix.subarray(0, pos + el.length), 0);
    head.set(newSize, pos + el.length);
    head.set(body, pos + el.length + newSize.length);
    head.set(duration, pos + el.length + newSize.length + body.length);
    return { head, consumed: bodyEnd };
  }
  return null;
}

/** 录音的各块拼成一个带时长的 WebM；补不了就原样拼 */
export async function finalizeWebm(chunks: Blob[], durationMs: number, type: string): Promise<Blob> {
  if (chunks.length === 0) return new Blob([], { type });
  const whole = new Blob(chunks, { type });
  try {
    const prefix = new Uint8Array(await whole.slice(0, 8192).arrayBuffer());
    const patched = patchWebmDuration(prefix, durationMs);
    return patched ? new Blob([patched.head.slice().buffer, whole.slice(patched.consumed)], { type }) : whole;
  } catch {
    return whole;
  }
}
