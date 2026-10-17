import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { useWritingPending } from '@/shared/lib/pending-writing';
import { trialApi } from '../api/backend';
import { newerRun } from '../api/run-events';
import type { AuthorRewrite, BackendRun, HumanAction, FinalizeInput } from '../types/backend';
type Request = { runId: string; operation: Operation };
type Operation = { kind: 'action'; input: HumanAction } | { kind: 'commit'; input: FinalizeInput };
export function useWritingActions(run: BackendRun | undefined, currentVersion?: number) {
  const client = useQueryClient();
  const [pending, setPending] = useState<Request | null>(null);
  const mutation = useMutation({
    mutationFn: async (request: Request) => {
      if (request.operation.kind === 'commit') {
        await trialApi.finalize(request.runId, request.operation.input);
        return trialApi.get(request.runId);
      }
      return trialApi.action(request.runId, request.operation.input);
    },
    retry: false,
    onSuccess: (next) => {
      client.setQueryData<BackendRun>(['backend-trial', next.id], (old) => newerRun(old, next));
      setPending(null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) setPending(null);
    },
    onSettled: () => {
      for (const key of [
        'backend-trial',
        'backend-draft',
        'planned-run-gate',
        'chapter-assembly',
        'live-book',
      ])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
  useWritingPending(!!pending || mutation.isPending);
  const current = !!run && run.draftVersion === currentVersion && run.status !== 'stale';
  const waiting = current && run?.status === 'waiting_human';
  const send = async (operation: Operation) => {
    if (!run || !current || pending || mutation.isPending) return false;
    if (operation.kind === 'action' && !waiting) return false;
    if (operation.kind === 'commit' && (run.status !== 'approved' || run.approvalBlock))
      return false;
    if (operation.kind === 'action' && operation.input.type === 'approve' && run.approvalBlock)
      return false;
    if (operation.kind === 'action' && operation.input.type === 'instruct' && run.instructionBlock)
      return false;
    const request = { runId: run.id, operation };
    setPending(request);
    try {
      await mutation.mutateAsync(request);
      return true;
    } catch {
      return false;
    }
  };
  const action = (input: Omit<HumanAction, 'id' | 'draftVersion'>) =>
    run &&
    send({
      kind: 'action',
      input: { ...input, id: crypto.randomUUID(), draftVersion: run.draftVersion },
    });
  const resumable =
    current && !!run?.pendingAction && ['interrupted', 'failed'].includes(run.status);
  const resume = () => {
    if (!resumable || !run?.pendingAction || pending || mutation.isPending) return;
    const request: Request = {
      runId: run.id,
      operation: { kind: 'action', input: run.pendingAction },
    };
    setPending(request);
    mutation.mutate(request);
  };
  return {
    resumable,
    resume,
    current,
    waiting,
    pending,
    mutation,
    busy: !!pending || mutation.isPending,
    approve: () => action({ type: 'approve' }),
    proposeFinding: (findingId: string, rewrite: AuthorRewrite) =>
      action({ type: 'propose_finding', findingId, rewrite }),
    applyFinding: (proposalId: string) => action({ type: 'apply_finding', proposalId }),
    discardFinding: (proposalId: string) => action({ type: 'discard_finding', proposalId }),
    editFinding: (findingId: string, rewrite: AuthorRewrite, text: string) =>
      action({ type: 'edit_finding', findingId, rewrite, text }),
    reviewBatch: () => action({ type: 'review_batch' }),
    decideFinding: (findingId: string, decision: 'keep' | 'reopen', instruction: string) =>
      action({ type: 'finding_decision', findingId, decision, instruction }),
    rewrite: (rewrite: AuthorRewrite) => action({ type: 'rewrite', rewrite }),
    edit: (segmentId: string, text: string) => action({ type: 'inline_edit', segmentId, text }),
    instruct: (instruction: string) => action({ type: 'instruct', instruction }),
    commit: () =>
      run?.inputDigest &&
      send({
        kind: 'commit',
        input: {
          id: crypto.randomUUID(),
          draftVersion: run.draftVersion,
          inputDigest: run.inputDigest,
          factsConfirmed: true,
        },
      }),
    retry: () => pending && mutation.mutate(pending),
  };
}
