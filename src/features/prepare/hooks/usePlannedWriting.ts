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
export function usePlannedWriting(
  chapterId: string,
  beatId: string,
  editing: boolean,
  instructionOwner?: string,
) {
  const client = useQueryClient();
  const localEdit = useWritingLocked();
  const otherRevisionEdits = useWritingLocked(instructionOwner);
  const planning = usePlanning();
  const [selection, setSelection] = useState<{ target: string; id: string | null } | null>(null);
  const target = chapterId + ':' + beatId;
  const runId = selection?.target === target ? selection.id : null;
  const setRunId = (id: string | null) => setSelection({ target, id });
  const [autoRevise, setAutoRevise] = useState(false);
  const [enhancedContinuity, setEnhancedContinuity] = useState(false);
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
  const activeID =
    runId ?? gate.data?.working?.runId ?? gate.data?.runs.find((r) => !r.dismissed)?.id ?? null;
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
  const dismiss = useMutation({
    mutationFn: () => plannedRunApi.dismiss(run!.id, run!.draftVersion),
    retry: false,
    onSuccess: async (result) => {
      client.setQueryData(['backend-trial', result.id], result);
      await client.invalidateQueries({ queryKey: ['planned-run-gate', chapterId] });
      const fresh = await gate.refetch();
      setRunId(
        fresh.data?.working?.runId ?? fresh.data?.runs.find((r) => !r.dismissed)?.id ?? null,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['chapter-assembly'] }),
        client.invalidateQueries({ queryKey: ['chapter-review'] }),
        client.invalidateQueries({ queryKey: ['chapter-facts'] }),
        client.invalidateQueries({ queryKey: ['chapter-publication'] }),
      ]);
      refresh();
    },
  });
  useWritingPending(start.isPending || !!pendingStart || dismiss.isPending);
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
        : !ready
          ? undefined // No response yet is not evidence of a version conflict.
          : !current
            ? t.stale
            : ready.reason;
  // Readiness polling can lag behind the run's SSE completion. Its running
  // block still disables starting another job, but is never a manuscript error.
  const blockIsProgress = Boolean(
    !editing &&
    !gate.isError &&
    !planning.isError &&
    current &&
    !ready?.ready &&
    ready?.runs?.some((candidate) => candidate.status === 'running'),
  );
  const loading = (!ready && gate.isPending) || (!!activeID && !run && runQuery.isPending);
  const runStale = Boolean(
    run?.planning &&
    p &&
    (!sameChapterPlanVersions(run.planning.expected, chapterPlanVersions(p)) ||
      plan?.version !== run.planning.planVersion),
  );
  const guardedRun =
    runStale && run && !run.commitId
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
      enhancedContinuity,
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
      enhancedContinuity,
    };
    setPendingStart(request);
    start.mutate(request);
  };
  // A rewrite consumes its own instruction draft. It must still respect every
  // other editor and unresolved request; rechecks consume no author input.
  const revisionBlock = (rewriting = false) => {
    const reviewReady = !rewriting && run?.planning?.mode === 'chapter' ? chapterGate.data : ready;
    if (editing) return '请先完成创作准备。';
    if (
      gate.isError ||
      planning.isError ||
      runQuery.isError ||
      draft.isError ||
      (!rewriting && run?.planning?.mode === 'chapter' && chapterGate.isError)
    )
      return '暂时无法核对最新状态，请恢复连接并刷新后重试。';
    if (rewriting ? otherRevisionEdits : localEdit)
      return '还有其他未保存的修改或未完成请求，请先处理。';
    if (pendingStart || start.isPending || run?.status === 'running')
      return '当前操作尚未完成，请等待或重试原请求。';
    if (!run) return '正在读取当前正文，请稍候。';
    if (!current || !reviewReady?.ready)
      return reviewReady?.reason || '正在核对最新上下文，请稍候再试。';
    return '';
  };
  const revise = async (rewrite?: AuthorRewrite) => {
    const wholeChapter = !rewrite && run?.planning?.mode === 'chapter';
    const reviewReady = wholeChapter ? chapterGate.data : ready;
    if (revisionBlock(!!rewrite) || !reviewReady || !run) return false;
    const request: PlannedRunRequest = {
      requestId: crypto.randomUUID(),
      chapterId,
      ...(wholeChapter ? {} : { beatId }),
      mode: wholeChapter ? 'chapter' : 'beat',
      expected: reviewReady.expected,
      planVersion: reviewReady.planVersion,
      draftVersion: reviewReady.draftVersion,
      autoRevise: false,
      enhancedContinuity,
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
    dismiss,
    chapterGate,
    beginChapter,
    revise,
    revisionBlock,
    planning,
    plan,
    gate,
    runQuery,
    draft,
    run: guardedRun,
    current,
    loading,
    block,
    blockIsProgress,
    autoRevise,
    setAutoRevise,
    enhancedContinuity,
    setEnhancedContinuity,
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
