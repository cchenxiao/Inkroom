import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import BackendTrialResult from './BackendTrialResult';
import { Badge, Button, Card, Select } from '@/shared/ui';
import { ApiError } from '@/shared/api/client';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import { trialApi } from '../api/backend';

export default function BackendTrial() {
  const [runId, setRunId] = useState<string | null>(null);
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const health = useQuery({
    queryKey: ['backend-health'],
    enabled: expanded,
    queryFn: trialApi.health,
    retry: false,
  });
  const [allowLocalRewrite, setAllowLocalRewrite] = useState(false);
  const [scenario, setScenario] = useState('normal');
  const [autoRevise, setAutoRevise] = useState(true);
  const [maxRounds, setMaxRounds] = useState<2 | 3>(2);
  const start = useMutation({
    mutationFn: trialApi.start,
    retry: false,
    onSuccess: (run) => {
      client.setQueryData(['backend-trial', run.id], run);
      setRunId(run.id);
    },
  });
  const query = useQuery({
    queryKey: ['backend-trial', runId],
    queryFn: () => trialApi.get(runId!),
    enabled: !!runId,
    retry: false,
    refetchInterval: (q) =>
      q.state.error ? false : q.state.data?.status === 'running' ? 1000 : false,
  });
  const recover = useMutation({
    mutationFn: trialApi.latest,
    retry: false,
    onSuccess: (run) => {
      client.setQueryData(['backend-trial', run.id], run);
      setRunId(run.id);
      start.reset();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) {
        setRunId(null);
        start.reset();
      }
    },
  });
  const run = query.data;
  const busy = start.isPending || run?.status === 'running';
  // POST 网络失败可能发生在服务端已受理之后，禁止自动重试。
  const uncertain = start.isError && !(start.error instanceof ApiError && start.error.status < 500);
  const error = start.error ?? query.error;
  return (
    <Card className="backend-trial">
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>{t.title}</summary>
        <div className="page-stack">
          <p className="text-dim">{t.description}</p>
          {health.data && (
            <p>
              {t.provider}：{health.data.provider} / {health.data.model}
            </p>
          )}
          <div className="backend-controls">
            {health.data?.provider === 'fake' && (
              <label>
                {t.scenario}
                <Select
                  aria-label={t.scenario}
                  value={scenario}
                  disabled={busy || uncertain}
                  onChange={(e) => setScenario(e.target.value)}
                >
                  {health.data.scenarios.map((s) => (
                    <option key={s} value={s}>
                      {t.scenarios[s] ?? s}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={allowLocalRewrite}
                disabled={busy || uncertain}
                onChange={(e) => setAllowLocalRewrite(e.target.checked)}
              />{' '}
              {t.localRewrite}
            </label>
            <label>
              <input
                type="checkbox"
                checked={autoRevise}
                disabled={busy || uncertain}
                onChange={(e) => setAutoRevise(e.target.checked)}
              />{' '}
              {t.autoRevise}
            </label>
            <label>
              {t.maxRounds}
              <Select
                aria-label={t.maxRounds}
                value={maxRounds}
                disabled={busy || uncertain}
                onChange={(e) => setMaxRounds(Number(e.target.value) as 2 | 3)}
              >
                <option value={2}>2 {t.rounds}</option>
                <option value={3}>3 {t.rounds}</option>
              </Select>
            </label>
          </div>
          <Button
            variant="default"
            loading={busy}
            disabled={uncertain}
            disabledReason={uncertain ? t.unknown : t.pending}
            onClick={() =>
              start.mutate({
                autoRevise,
                allowLocalRewrite,
                scenario: health.data?.provider === 'fake' ? scenario : 'normal',
                maxRounds,
              })
            }
          >
            {t.start}
          </Button>
          <Button
            onClick={() => recover.mutate()}
            loading={recover.isPending}
            disabled={start.isPending}
            disabledReason={t.pending}
          >
            {t.recover}
          </Button>
          {recover.isError && (
            <p role="alert">
              {recover.error instanceof ApiError && recover.error.status === 404
                ? t.none
                : t.connection}
            </p>
          )}
          {!run && !error && <p className="text-dim">{t.empty}</p>}
          {error && (
            <div role="alert">
              <p>{t.connection}</p>
              <p>{error instanceof ApiError ? error.message : t.queryError}</p>
              {runId && <Button onClick={() => void query.refetch()}>{t.retry}</Button>}
              {uncertain && <p>{t.unknown}</p>}
            </div>
          )}
          {run && (
            <>
              <div className="page-actions" aria-live="polite">
                <Badge tone={run.status === 'failed' ? 'danger' : 'ai'}>
                  {run.status === 'running'
                    ? t.running
                    : run.status === 'completed'
                      ? t.completed
                      : run.status === 'waiting_human' || run.status === 'needs_human'
                        ? t.waitingHuman
                        : run.status === 'escalated'
                          ? t.escalated
                          : t.failed}
                </Badge>
                <span>
                  {run.provider} · {run.model}
                </span>
                <span>
                  {t.tokens} {run.tokens} · {t.elapsed} {(run.elapsedMs / 1000).toFixed(1)}{' '}
                  {t.seconds}
                </span>
              </div>
              {run.status !== 'running' && run.usage?.known === false && <p>{t.usageUnknown}</p>}
              {run.error && (
                <p role="alert" className="page-error">
                  {run.error}
                </p>
              )}
              <p>
                {t.nodes[run.currentNode] ?? run.currentNode} · {t.progress} {run.reviseRound}/
                {run.maxRounds} · {t.version} v{run.draftVersion}
              </p>
              {run.result?.stopReason && <p role="status">{run.result.stopReason}</p>}
              {run.result && <BackendTrialResult result={run.result} />}
            </>
          )}
        </div>
      </details>
    </Card>
  );
}
