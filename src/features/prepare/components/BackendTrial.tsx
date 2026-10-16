import { readableMessage } from '@/shared/lib/business-labels';
import { TechnicalDetails } from '@/shared/ui/technical-details';
import { lazy, Suspense, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import BackendTrialResult from './BackendTrialResult';
import BackendHumanGate from './BackendHumanGate';
import BackendContextManifest from './BackendContextManifest';
import BackendLookupTrace from './BackendLookupTrace';
import BackendCriticLookup from './BackendCriticLookup';
import BackendFinalize from './BackendFinalize';
import BackendDraft from './BackendDraft';
import BackendRunHistory from './BackendRunHistory';
import { Badge, Button, Card, Select } from '@/shared/ui';
import { ApiError } from '@/shared/api/client';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import { trialApi } from '../api/backend';
import { newerRun } from '../api/run-events';
import { useBackendEvents } from '../hooks/useBackendEvents';
import type { BackendRun } from '../types/backend';
const BackendRunFlow = lazy(() => import('./BackendRunFlow'));

export default function BackendTrial() {
  const [runId, setRunId] = useState<string | null>(() =>
    localStorage.getItem('inkloom.backendRun'),
  );
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const streamStatus = useBackendEvents(runId, expanded);
  useEffect(() => {
    if (runId) localStorage.setItem('inkloom.backendRun', runId);
    else localStorage.removeItem('inkloom.backendRun');
  }, [runId]);
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
      client.setQueryData<BackendRun>(['backend-trial', run.id], (old) => newerRun(old, run));
      setRunId(run.id);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.body.code === 'version_mismatch') {
        void client.invalidateQueries({ queryKey: ['backend-draft'] });
        void client.invalidateQueries({ queryKey: ['backend-trial'] });
      }
    },
  });
  const query = useQuery({
    queryKey: ['backend-trial', runId],
    queryFn: ({ signal }) => trialApi.get(runId!, signal),
    enabled: !!runId && expanded,
    retry: false,
    structuralSharing: (old, next) => newerRun(old as BackendRun | undefined, next as BackendRun),
  });
  const recover = useMutation({
    mutationFn: trialApi.latest,
    retry: false,
    onSuccess: (run) => {
      client.setQueryData<BackendRun>(['backend-trial', run.id], (old) => newerRun(old, run));
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
  const draft = useQuery({
    queryKey: ['backend-draft'],
    queryFn: ({ signal }) => trialApi.draft(undefined, signal),
    enabled: expanded,
    retry: false,
  });
  useEffect(() => {
    if (expanded) void client.invalidateQueries({ queryKey: ['backend-draft'] });
  }, [client, expanded, run?.draftVersion, run?.status]);
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
            disabled={uncertain || !draft.data || draft.isError}
            disabledReason={uncertain ? t.unknown : t.draftError}
            onClick={() =>
              start.mutate({
                draftVersion: draft.data!.draftVersion,
                autoRevise,
                allowLocalRewrite,
                scenario: health.data?.provider === 'fake' ? scenario : 'normal',
                maxRounds,
              })
            }
          >
            {draft.data?.draftVersion ? t.regenerate : t.start}
          </Button>
          <Button
            onClick={() => recover.mutate()}
            loading={recover.isPending}
            disabled={start.isPending}
            disabledReason={t.pending}
          >
            {t.recover}
          </Button>
          {draft.isPending && <p>{t.loadDraft}</p>}
          {draft.isError && (
            <p role="alert">
              {t.draftError} <Button onClick={() => void draft.refetch()}>{t.reloadDraft}</Button>
            </p>
          )}
          {draft.data && <BackendDraft draft={draft.data} />}
          <BackendRunHistory
            runId={runId}
            onSelect={(id) => {
              setRunId(id);
              start.reset();
            }}
          />
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
              <p>
                {error instanceof ApiError && error.body.code === 'version_mismatch'
                  ? t.startVersionMismatch
                  : t.connection}
              </p>
              <p>{error instanceof ApiError ? error.message : t.queryError}</p>
              {runId && <Button onClick={() => void query.refetch()}>{t.retry}</Button>}
              {uncertain && <p>{t.unknown}</p>}
            </div>
          )}
          {run && (
            <>
              <div className="page-actions" aria-live="polite">
                <Badge
                  tone={
                    run.status === 'approved' || run.status === 'committed'
                      ? 'human'
                      : run.status === 'failed'
                        ? 'danger'
                        : 'ai'
                  }
                >
                  {run.status === 'committed'
                    ? t.committed
                    : run.status === 'approved'
                      ? t.approved
                      : run.status === 'stale'
                        ? t.staleRun
                        : run.status === 'interrupted'
                          ? t.interruptedRun
                          : run.status === 'running'
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
                  {readableMessage(
                    run.error,
                    '本次创作未完成，已保存内容保留；请检查运行记录后重试。',
                  )}
                </p>
              )}
              <p>
                {t.nodes[run.currentNode] ?? '状态待更新'} · {t.progress} {run.reviseRound}/
                {run.maxRounds} · {t.version} v{run.draftVersion}
              </p>
              <p role="status">{t.streamStates[streamStatus]}</p>
              <TechnicalDetails
                items={{ 运行编号: run.id, 错误原文: run.error, 最新事件序号: run.eventSequence }}
              />
              {expanded && (
                <Suspense fallback={<p>{t.loadGraph}</p>}>
                  <BackendRunFlow run={run} />
                </Suspense>
              )}
              {run.result?.stopReason && <p role="status">{run.result.stopReason}</p>}
              <BackendLookupTrace run={run} />
              <BackendCriticLookup run={run} />
              <BackendContextManifest key={`context-${run.id}`} run={run} />
              {run.canResume && run.status !== 'committed' && (
                <BackendHumanGate
                  key={run.id}
                  run={run}
                  currentVersion={draft.data?.draftVersion}
                />
              )}
              <BackendFinalize
                key={`commit-${run.id}`}
                run={run}
                currentVersion={draft.data?.draftVersion}
              />
              {run.result && (
                <BackendTrialResult
                  result={run.result}
                  stale={
                    run.status === 'stale' ||
                    (!!draft.data && run.result.draftVersion !== draft.data.draftVersion)
                  }
                />
              )}
            </>
          )}
        </div>
      </details>
    </Card>
  );
}
