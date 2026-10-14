import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useChapter } from '@/shared/api/hooks';
import { streamRun } from '@/shared/api/stream';
import { endpoints, queryKeys } from '@/shared/api/endpoints';
import type { RunState } from '@/types/domain';
import { useUIStore } from '@/shared/lib/ui-store';
import { shellText as t } from '@/shared/lib/messages-shell';
export function RunEvents() {
  const { data } = useChapter();
  const id = data?.run.id;
  const client = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    void streamRun(
      endpoints.events(id),
      (event) => {
        useUIStore.getState().addEvent(event);
        if (event.data.run) {
          const run = event.data.run;
          client.setQueryData<RunState>(queryKeys.resource(endpoints.run(run.id)), run);
        }
        if (
          [
            'run.started',
            'findings.ready',
            'run.finished',
            'gate.waiting',
            'escalated',
            'conflict.created',
            'version.stale',
            'index.updating',
          ].includes(event.type)
        ) {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(
            () => void client.invalidateQueries({ queryKey: queryKeys.all }),
            120,
          );
        }
        if (event.type === 'index.updating') {
          const toastId = `index-${event.runId}`;
          if (event.data.phase === 'ready')
            toast.success(event.data.message ?? t.sync, { id: toastId });
          else toast.loading(event.data.message ?? t.index, { id: toastId });
        }
        if (event.type === 'version.stale') toast.warning(t.stale);
        if (event.type === 'escalated') toast.warning(event.data.message ?? t.escalate);
        if (event.type === 'run.failed') toast.error(event.data.message ?? t.status.failed);
        if (event.type === 'run.finished') toast.success(event.data.message ?? t.finish);
      },
      abort.signal,
      (message) => toast.error(message),
    );
    return () => {
      abort.abort();
      clearTimeout(refreshTimer);
    };
  }, [id, client]);
  return null;
}
