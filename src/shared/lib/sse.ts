import type { RunEvent } from '@/types/domain';
/** 按 SSE 帧解码，缓存由调用者保存，支持网络分块与多行 data。 */
export function decodeSSE(buffer: string): { events: RunEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames = normalized.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: RunEvent[] = [];
  for (const frame of frames) {
    const lines = frame.split('\n');
    const payload = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!payload) continue;
    try {
      const data = JSON.parse(payload) as RunEvent;
      const id = lines
        .find((l) => l.startsWith('id:'))
        ?.slice(3)
        .trim();
      const type = lines
        .find((l) => l.startsWith('event:'))
        ?.slice(6)
        .trim();
      events.push({ ...data, id: id || data.id, type: (type || data.type) as RunEvent['type'] });
    } catch {
      /* incomplete/invalid frame is ignored; stream remains usable */
    }
  }
  return { events, rest };
}
