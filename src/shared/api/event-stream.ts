import { ApiError, apiHeaders, GO_API_BASE } from './client';
import { parseFrames, type SSEFrame } from '@/shared/lib/event-stream';

/** Fetch SSE 与 REST 复用地址/鉴权；只重连 GET，绝不重发启动/人工操作。 */
export async function readBackendEvents(
  path: string,
  cursor: string,
  signal: AbortSignal,
  onFrame: (frame: SSEFrame) => void,
  onOpen: () => void,
) {
  const response = await fetch(`${GO_API_BASE}${path}`, {
    signal,
    headers: {
      ...apiHeaders(),
      Accept: 'text/event-stream',
      ...(cursor ? { 'Last-Event-ID': cursor } : {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.json());
  }
  if (!response.headers.get('Content-Type')?.includes('text/event-stream') || !response.body) {
    throw new Error('Invalid SSE response');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  onOpen();
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 4 * 1024 * 1024) throw new Error('SSE frame too large');
      const parsed = parseFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) onFrame(frame);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
