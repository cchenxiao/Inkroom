import { useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Badge } from '@/shared/ui';
import { ApiError } from '@/shared/api/client';
import { plannedRunMessages as t } from '@/shared/lib/messages-planned-run';
import { plannedRunApi, type PlannedRunRequest } from '../api/planned-run';
import { trialApi } from '../api/backend';
import { newerRun } from '../api/run-events';
import type { BackendRun } from '../types/backend';
import { useBackendEvents } from '../hooks/useBackendEvents';
import { usePlanning } from '../hooks/usePlanning';
import { chapterPlanVersions, sameChapterPlanVersions } from '../types/chapter-plan';
import BackendHumanGate from './BackendHumanGate';
import BackendContextManifest from './BackendContextManifest';
import BackendFinalize from './BackendFinalize';
import BackendTrialResult from './BackendTrialResult';
import { assemblyMessages } from '@/shared/lib/messages-assembly';

export default function PlannedBeatWriting({
  chapterId,
  editing,
}: {
  chapterId: string;
  editing: boolean;
}) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const planning = usePlanning();
  const [runId, setRunId] = useState<string | null>(null),
    [autoRevise, setAutoRevise] = useState(false);
  const [chosenBeat, setChosenBeat] = useState('');
  const plan = planning.data?.chapterPlans?.find((c) => c.chapterId === chapterId);
  const beatId = chosenBeat || plan?.content?.brief.selectedBeatId || '';
  const requestKey = useRef<{ key: string; id: string } | null>(null);
  const gate = useQuery({
    queryKey: ['planned-run-gate', chapterId, beatId],
    queryFn: ({ signal }) => plannedRunApi.get(chapterId, signal, beatId),
    retry: false,
    refetchInterval: 2500,
  });
  const activeID = runId ?? gate.data?.runs[0]?.id ?? null;
  const runQuery = useQuery({
    queryKey: ['backend-trial', activeID],
    queryFn: ({ signal }) => trialApi.get(activeID!, signal),
    enabled: Boolean(activeID),
    retry: false,
    refetchInterval: 2500,
    structuralSharing: (old, next) => newerRun(old as BackendRun | undefined, next as BackendRun),
  });
  useBackendEvents(activeID, Boolean(activeID));
  const run = runQuery.data;
  const draft = useQuery({
    queryKey: ['backend-draft', 'planned', run?.chapterId],
    queryFn: ({ signal }) => plannedRunApi.draft(run!.chapterId, signal),
    enabled: Boolean(run),
    retry: false,
    refetchInterval: 2500,
  });
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['planned-run-gate', chapterId] });
  }, [client, chapterId, planning.data?.chapterPlans, run?.draftVersion, run?.status]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['planned-run-gate', chapterId] });
    void client.invalidateQueries({ queryKey: ['backend-trial', activeID] });
    void client.invalidateQueries({ queryKey: ['backend-draft'] });
  };
  const start = useMutation({
    mutationFn: (req: Omit<PlannedRunRequest, 'requestId'>) => {
      const key = JSON.stringify(req);
      if (requestKey.current?.key !== key) requestKey.current = { key, id: crypto.randomUUID() };
      return plannedRunApi.start({ ...req, requestId: requestKey.current.id });
    },
    retry: false,
    onSuccess: (r) => {
      requestKey.current = null;
      client.setQueryData(['backend-trial', r.id], r);
      setRunId(r.id);
      refresh();
    },
    onError: refresh,
  });
  const ready = gate.data;
  const p = planning.data;

  const current = Boolean(
    ready &&
    p &&
    plan?.confirmed &&
    ready.planVersion === plan.version &&
    sameChapterPlanVersions(ready.expected, chapterPlanVersions(p)),
  );
  const block = editing
    ? t.editing
    : gate.isError || planning.isError
      ? t.error
      : !plan?.confirmed
        ? ready?.reason || t.notReady
        : !current
          ? t.stale
          : ready?.reason;
  const runStale = Boolean(
    run?.planning &&
    p &&
    (!sameChapterPlanVersions(run.planning.expected, chapterPlanVersions(p)) ||
      plan?.version !== run.planning.planVersion),
  );
  const guardedRun =
    runStale && run
      ? { ...run, status: 'stale' as const, approvalBlock: t.stale, instructionBlock: t.stale }
      : run;
  return (
    <Card className="core-workbench" aria-label={t.title}>
      <div className="core-heading">
        <h3>{t.title}</h3>
        <Button size="sm" onClick={refresh}>
          {t.refresh}
        </Button>
      </div>
      <p className="muted">{t.note}</p>
      <label>
        {assemblyMessages.targetBeat}
        <select
          value={beatId}
          disabled={start.isPending}
          onChange={(e) => {
            setChosenBeat(e.target.value);
            setRunId(null);
          }}
        >
          {plan?.content?.scenes.flatMap((scene) =>
            scene.beats.map((beat) => (
              <option key={beat.id} value={beat.id}>
                {scene.title} · {beat.title}
              </option>
            )),
          )}
        </select>
      </label>
      <p className="muted">{assemblyMessages.targetNote}</p>
      <Button
        size="sm"
        onClick={() => {
          const next = new URLSearchParams(params);
          next.set('section', 'knowledge');
          setParams(next);
        }}
      >
        {t.knowledge}
      </Button>
      {!ready && (
        <p role={gate.isError ? 'alert' : 'status'}>{gate.isError ? t.error : t.loading}</p>
      )}
      {ready && (
        <>
          <label className="outline-check">
            <input
              type="checkbox"
              checked={autoRevise}
              disabled={start.isPending || run?.status === 'running'}
              onChange={(e) => setAutoRevise(e.target.checked)}
            />
            {t.authorize}
          </label>
          <Button
            variant="default"
            loading={start.isPending}
            disabled={
              Boolean(block) || !ready.ready || start.isPending || run?.status === 'running'
            }
            disabledReason={block || t.running}
            onClick={() => {
              if (ready.draftVersion > 0 && !window.confirm(t.regenerate)) return;
              start.mutate({
                chapterId,
                beatId: ready.beatId,
                expected: ready.expected,
                planVersion: ready.planVersion,
                draftVersion: ready.draftVersion,
                autoRevise,
              });
            }}
          >
            {t.start}
          </Button>
          {block && <p>{block}</p>}
        </>
      )}
      {start.isError && (
        <p role="alert">{start.error instanceof ApiError ? start.error.message : t.error}</p>
      )}
      {ready?.runs.length === 0 && <p>{t.empty}</p>}
      {!!ready?.runs.length && (
        <label>
          {t.history}
          <select value={activeID ?? ''} onChange={(e) => setRunId(e.target.value)}>
            {ready.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleString('zh-CN')} · v{r.draftVersion} · {r.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {runQuery.isError && <p role="alert">{t.error}</p>}
      {guardedRun && (
        <>
          <div className="core-heading">
            <Badge>{guardedRun.status}</Badge>
            <span>
              {t.source} v{run?.planning?.planVersion} · {t.model} {run?.provider}/{run?.model}
            </span>
          </div>
          {run?.planning?.knowledge && (
            <p>
              {t.published} v{run.planning.knowledge.version}
            </p>
          )}
          {run?.provider === 'fake' && <p>{t.fake}</p>}
          {run?.status === 'running' && <p role="status">{t.running}</p>}
          {run?.error && <p role="alert">{run.error}</p>}
          {run?.result && (
            <>
              <h3>
                {t.candidate} · v{run.draftVersion}
              </h3>
              <div className="backend-candidate">
                {run.result.segments.map((s) => (
                  <p key={s.id}>{s.text}</p>
                ))}
              </div>
            </>
          )}
          <p className="muted">{t.segmentNote}</p>
          <BackendHumanGate
            key={`human-${run?.id}`}
            run={guardedRun}
            currentVersion={
              draft.isError || planning.isError || runQuery.isError
                ? undefined
                : draft.data?.draftVersion
            }
          />
          <BackendFinalize
            key={`final-${run?.id}`}
            run={guardedRun}
            chapterId={guardedRun.chapterId}
            currentVersion={
              draft.isError || planning.isError || runQuery.isError
                ? undefined
                : draft.data?.draftVersion
            }
          />
          <BackendContextManifest run={guardedRun} />
          {run?.result && (
            <details>
              <summary>{t.audit}</summary>
              <BackendTrialResult result={run.result} stale={guardedRun.status === 'stale'} />
            </details>
          )}
        </>
      )}
    </Card>
  );
}
