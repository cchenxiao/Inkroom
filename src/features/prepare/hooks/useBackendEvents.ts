import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { readBackendEvents } from '@/shared/api/event-stream';
import { refreshEventQueries } from '../api/refresh-events';
import { trialApi } from '../api/backend';
import { consumeRunEvent, EventGap, newerRun } from '../api/run-events';
import type { BackendRun } from '../types/backend';

export type StreamStatus =
  'idle' | 'connecting' | 'live' | 'reconnecting' | 'resyncing' | 'missing';

export function useBackendEvents(runId: string | null, enabled: boolean) {
  const client = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('idle');
  useEffect(() => {
    if (!runId || !enabled) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let cursor = client.getQueryData<BackendRun>(['backend-trial', runId])?.eventSequence;
    let delay = 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const pause = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, delay);
      });
    const save = (next: BackendRun) => {
      if (signal.aborted) return;
      client.setQueryData<BackendRun>(['backend-trial', runId], (old) => newerRun(old, next));
    };
    const loop = async () => {
      setStatus('connecting');
      while (!signal.aborted) {
        try {
          if (cursor === undefined) {
            const snapshot = await trialApi.get(runId, signal);
            if (signal.aborted) return;
            save(snapshot);
            cursor = snapshot.eventSequence;
            void refreshEventQueries(client, [['backend-draft'], ['backend-calls', runId]]);
          }
          await readBackendEvents(
            `/runs/${encodeURIComponent(runId)}/events`,
            `${runId}:${cursor}`,
            signal,
            (frame) => {
              const event = consumeRunEvent(frame, runId, cursor!);
              if (!event || signal.aborted) return;
              save(event.run);
              cursor = event.sequence; // 仅成功应用后推进；重复帧不会再次失效缓存。
              delay = 500;
              if (event.type.startsWith('model.') || event.type === 'run.failed') {
                void refreshEventQueries(client, [['backend-calls', runId]]);
              }
              if (
                [
                  'draft.saved',
                  'findings.ready',
                  'version.stale',
                  'revise.round',
                  'gate.waiting',
                  'run.finished',
                  'commit.created',
                ].includes(event.type)
              ) {
                void refreshEventQueries(client, [
                  ['backend-draft'],
                  ['backend-versions'],
                  ['backend-runs'],
                  ['backend-commits'],
                ]);
              }
            },
            () => {
              if (!signal.aborted) setStatus('live');
            },
          );
          if (signal.aborted) return;
          setStatus('reconnecting');
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof ApiError && error.status === 404) {
            setStatus('missing');
            return;
          }
          if (
            error instanceof EventGap ||
            (error instanceof ApiError && (error.status === 410 || error.status === 400))
          ) {
            cursor = undefined;
            setStatus('resyncing');
          } else setStatus('reconnecting');
        }
        await pause();
        delay = Math.min(delay * 2, 8000);
      }
    };
    void loop();
    return () => {
      controller.abort();
      clearTimeout(timer);
      wake?.();
    };
  }, [client, runId, enabled]);
  return status;
}
