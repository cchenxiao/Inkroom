import { API_BASE, apiHeaders } from './client';
import { decodeSSE } from '@/shared/lib/sse';
import type { RunEvent } from '@/types/domain';
export async function streamRun(
  path: string,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
  onError?: (message: string) => void,
) {
  let lastId = '';
  const seen = new Set<string>();
  for (let attempt = 0; !signal.aborted; attempt++) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        signal,
        headers: {
          ...apiHeaders(),
          Accept: 'text/event-stream',
          ...(lastId ? { 'Last-Event-ID': lastId } : {}),
        },
      });
      if (!response.ok || !response.body) throw new Error(`事件流连接失败 (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = decodeSSE(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (seen.has(event.id)) continue;
            seen.add(event.id);
            lastId = event.id;
            onEvent(event);
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (signal.aborted) return;
    } catch (error) {
      if (signal.aborted) return;
      if (attempt === 3) onError?.(error instanceof Error ? error.message : '事件流断开');
    }
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.min(1000 * 2 ** Math.min(attempt, 5), 15000));
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
