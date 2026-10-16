import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWritingLocked, useWritingPending } from '@/shared/lib/pending-writing';
import { ApiError } from '@/shared/api/client';
import { plannedRunMessages as t } from '@/shared/lib/messages-planned-run';
import { plannedRunApi, type PlannedRunRequest } from '../api/planned-run';
import { trialApi } from '../api/backend';
import { newerRun } from '../api/run-events';
import type { AuthorRewrite, BackendRun } from '../types/backend';
import { useBackendEvents } from './useBackendEvents';
import { usePlanning } from './usePlanning';
import { chapterPlanVersions, sameChapterPlanVersions } from '../types/chapter-plan';
/** Real data controller. It owns no alternate workspace or manuscript presentation. */
export function usePlannedWriting(chapterId: string, beatId: string, editing: boolean) {
  const client = useQueryClient();
  const localEdit = useWritingLocked();
  const planning = usePlanning();
  const [selection, setSelection] = useState<{ target: string; id: string | null } | null>(null);
  const target = chapterId + ':' + beatId;
  const runId = selection?.target === target ? selection.id : null;
  const setRunId = (id: string | null) => setSelection({ target, id });
  const [autoRevise, setAutoRevise] = useState(false);
  const plan = planning.data?.chapterPlans?.find((c) => c.chapterId === chapterId);

  const [pendingStart, setPendingStart] = useState<PlannedRunRequest | null>(null);
  const gate = useQuery({
    queryKey: ['planned-run-gate', chapterId, beatId],
    queryFn: ({ signal }) => plannedRunApi.get(chapterId, signal, beatId),
    enabled: Boolean(chapterId),
    retry: false,
    refetchInterval: 2500,
  });
  const chapterGate = useQuery({
    queryKey: ['planned-chapter-gate', chapterId],
    queryFn: ({ signal }) => plannedRunApi.get(chapterId, signal, undefined, 'chapter'),
    enabled: Boolean(chapterId),
    retry: false,
    refetchInterval: 5000,
  });
  const activeID = runId ?? gate.data?.runs[0]?.id ?? null;
  useEffect(() => {
    if (activeID)
      setSelection((old) => (old?.target === target && old.id ? old : { target, id: activeID }));
  }, [activeID, target]);
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
    void client.invalidateQueries({ queryKey: ['planned-chapter-gate', chapterId] });
    void client.invalidateQueries({ queryKey: ['planned-run-gate', chapterId] });
    void client.invalidateQueries({ queryKey: ['backend-trial', activeID] });
    void client.invalidateQueries({ queryKey: ['backend-draft'] });
  };
  const start = useMutation({
    mutationFn: plannedRunApi.start,
    retry: false,
    onSuccess: (r) => {
      setPendingStart(null);
      client.setQueryData(['backend-trial', r.id], r);
      setRunId(r.id);
      refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) setPendingStart(null);
      refresh();
    },
  });
  useWritingPending(start.isPending || !!pendingStart);
  const { isError: startFailed, reset: resetStart } = start;
  useEffect(() => {
    const id = pendingStart?.requestId;
    const recovered = id && gate.data?.runs.find((r) => r.id === id);
    if (recovered && startFailed) {
      setPendingStart(null);
      setSelection({ target, id: recovered.id });
      resetStart();
    }
  }, [gate.data?.runs, pendingStart, startFailed, resetStart, target]);
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

  const begin = (confirmed = false) => {
    if (
      !ready?.ready ||
      block ||
      localEdit ||
      pendingStart ||
      start.isPending ||
      run?.status === 'running'
    )
      return;
    if (!confirmed && ready.draftVersion > 0 && !window.confirm(t.regenerate)) return;
    const req: PlannedRunRequest = {
      requestId: crypto.randomUUID(),
      chapterId,
      beatId: ready.beatId,
      expected: ready.expected,
      planVersion: ready.planVersion,
      draftVersion: ready.draftVersion,
      autoRevise,
    };
    setPendingStart(req);
    start.mutate(req);
  };
  const beginChapter = () => {
    const ready = chapterGate.data;
    if (
      !ready?.ready ||
      editing ||
      localEdit ||
      pendingStart ||
      start.isPending ||
      run?.status === 'running'
    )
      return;
    if (
      ready.draftVersion > 0 &&
      !window.confirm('生成整章新候选？已采用正文会保留，新稿需要重新审核后采用。')
    )
      return;
    const request: PlannedRunRequest = {
      requestId: crypto.randomUUID(),
      chapterId,
      mode: 'chapter',
      expected: ready.expected,
      planVersion: ready.planVersion,
      draftVersion: ready.draftVersion,
      autoRevise,
    };
    setPendingStart(request);
    start.mutate(request);
  };
  const revise = async (rewrite?: AuthorRewrite) => {
    if (
      !ready?.ready ||
      !current ||
      editing ||
      !run ||
      pendingStart ||
      start.isPending ||
      run.status === 'running'
    )
      return false;
    const request: PlannedRunRequest = {
      requestId: crypto.randomUUID(),
      chapterId,
      beatId,
      mode: 'beat',
      expected: ready.expected,
      planVersion: ready.planVersion,
      draftVersion: ready.draftVersion,
      autoRevise: false,
      fromRunId: run.id,
      sourceVersion: run.draftVersion,
      ...(rewrite ? { rewrite } : { recheck: true }),
    };
    setPendingStart(request);
    try {
      await start.mutateAsync(request);
      return true;
    } catch {
      return false;
    }
  };
  return {
    chapterGate,
    beginChapter,
    revise,
    planning,
    plan,
    gate,
    runQuery,
    draft,
    run: guardedRun,
    current,
    block,
    autoRevise,
    setAutoRevise,
    activeID,
    setRunId,
    localEdit,
    start,
    begin,
    pendingStart,
    retryStart: () => pendingStart && start.mutate(pendingStart),
    refresh,
  };
}
