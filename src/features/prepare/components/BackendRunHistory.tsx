import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@/shared/ui';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import { trialApi } from '../api/backend';

export default function BackendRunHistory({
  runId,
  onSelect,
}: {
  runId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [callsOpen, setCallsOpen] = useState(false);
  const runs = useQuery({
    queryKey: ['backend-runs', runId],
    queryFn: trialApi.runs,
    enabled: open,
    retry: false,
  });
  const calls = useQuery({
    queryKey: ['backend-calls', runId],
    queryFn: () => trialApi.calls(runId!),
    enabled: !!runId && callsOpen,
    retry: false,
    refetchInterval: callsOpen ? 2000 : false,
  });
  return (
    <>
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{t.storedRuns}</summary>
        {runs.isFetching && <p>{t.loadDraft}</p>}
        {runs.isError && <Button onClick={() => void runs.refetch()}>{t.retry}</Button>}
        {runs.data?.length === 0 && <p>{t.none}</p>}
        {runs.data?.map((r) => (
          <p key={r.id}>
            v{r.draftVersion} · {new Date(r.createdAt).toLocaleString('zh-CN')} · {r.provider}{' '}
            <Button onClick={() => onSelect(r.id)}>{t.loadRun}</Button>
          </p>
        ))}
      </details>
      {runId && (
        <details onToggle={(e) => setCallsOpen(e.currentTarget.open)}>
          <summary>{t.modelCalls}</summary>
          {calls.isFetching && <p>{t.loadDraft}</p>}
          {calls.isError && <Button onClick={() => void calls.refetch()}>{t.retry}</Button>}
          {calls.data?.length === 0 && <p>{t.noCalls}</p>}
          {calls.data?.map((c) => (
            <p key={c.number}>
              <Badge tone="ai">#{c.number}</Badge> {c.role} · {c.promptVersion} ·{' '}
              {c.phase === 'unknown'
                ? t.unknownCall
                : c.phase === 'started'
                  ? t.startedCall
                  : c.success
                    ? t.callFinished
                    : t.failed}{' '}
              ·{' '}
              {c.usage.known
                ? `${c.usage.inputTokens + c.usage.outputTokens} token`
                : t.usageUnknown}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
