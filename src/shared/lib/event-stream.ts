/** SSE 帧解析与业务模型分离。残帧保留，损坏帧不推进消费游标。 */
export interface SSEFrame {
  id: string;
  type: string;
  data: string;
}
export function parseFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  const frames: SSEFrame[] = [];
  for (const part of parts) {
    let id = '',
      type = 'message';
    const data: string[] = [];
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') id = value;
      if (field === 'event') type = value;
      if (field === 'data') data.push(value);
    }
    if (data.length) frames.push({ id, type, data: data.join('\n') });
  }
  return { frames, rest };
}
