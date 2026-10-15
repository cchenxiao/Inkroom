import type { SSEFrame } from '@/shared/lib/event-stream';
import type { BackendRun, BackendRunEvent } from '../types/backend';

export class EventGap extends Error {}
/** 查询、操作响应与 SSE 可能交错；旧快照绝不能覆盖更高序号的状态。 */
export function newerRun(old: BackendRun | undefined, next: BackendRun): BackendRun {
  return old?.id === next.id && old.eventSequence > next.eventSequence ? old : next;
}
export function consumeRunEvent(
  frame: SSEFrame,
  runId: string,
  cursor: number,
): BackendRunEvent | null {
  let event: BackendRunEvent;
  try {
    event = JSON.parse(frame.data) as BackendRunEvent;
  } catch {
    throw new EventGap('Malformed run event');
  }
  if (
    event.runId !== runId ||
    event.run?.id !== runId ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1 ||
    frame.id !== `${runId}:${event.sequence}` ||
    frame.type !== event.type ||
    event.run.eventSequence !== event.sequence
  )
    throw new EventGap('Invalid run event');
  if (event.sequence <= cursor) return null;
  if (event.sequence !== cursor + 1) throw new EventGap('Missing run event');
  return event;
}
