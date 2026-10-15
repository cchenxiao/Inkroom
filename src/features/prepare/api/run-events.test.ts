import { describe, expect, it } from 'vitest';
import { parseFrames } from '@/shared/lib/event-stream';
import { consumeRunEvent, EventGap, newerRun } from './run-events';
import type { BackendRun, BackendRunEvent } from '../types/backend';

describe('可靠进度消费', () => {
  const run = { id: 'r', eventSequence: 2, status: 'waiting_human' } as BackendRun;
  const event: BackendRunEvent = {
    runId: 'r',
    sequence: 2,
    type: 'gate.waiting',
    createdAt: '',
    run,
  };
  const wire = `id: r:2\r\nevent: gate.waiting\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
  it('网络任意分块保留残帧，忽略心跳', () => {
    for (let i = 0; i < wire.length; i++) {
      const first = parseFrames(wire.slice(0, i));
      const second = parseFrames(first.rest + wire.slice(i));
      const frames = [...first.frames, ...second.frames];
      expect(frames).toHaveLength(1);
      expect(consumeRunEvent(frames[0], 'r', 1)).toEqual(event);
    }
    expect(parseFrames(': heartbeat\n\n').frames).toEqual([]);
  });
  it('重复帧不重复应用，序号缺口和跨运行帧必须重取快照', () => {
    const frame = parseFrames(wire).frames[0];
    expect(consumeRunEvent(frame, 'r', 2)).toBeNull();
    expect(() => consumeRunEvent(frame, 'r', 0)).toThrow(EventGap);
    expect(() => consumeRunEvent(frame, 'other', 1)).toThrow(EventGap);
    expect(() => consumeRunEvent({ ...frame, data: '{' }, 'r', 1)).toThrow();
  });
  it('迟到 REST 不能回退已消费的 SSE 状态', () => {
    expect(newerRun(run, { ...run, eventSequence: 1, status: 'running' })).toBe(run);
    expect(newerRun(run, { ...run, eventSequence: 3, status: 'approved' }).status).toBe('approved');
  });
});

it('事件到达时取消首个旧查询，重新读取提交后的状态', async () => {
  const { QueryClient, QueryObserver } = await import('@tanstack/react-query');
  const { refreshEventQueries } = await import('./refresh-events');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let completeOld!: (value: string) => void;
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: ['backend-calls', 'r'],
    queryFn: () =>
      ++calls === 1
        ? new Promise<string>((resolve) => {
            completeOld = resolve;
          })
        : Promise.resolve('finished'),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const refresh = refreshEventQueries(client, [['backend-calls', 'r']]);
  completeOld('started');
  await refresh;
  expect(calls).toBe(2);
  expect(client.getQueryData(['backend-calls', 'r'])).toBe('finished');
  unsubscribe();
  client.clear();
});
