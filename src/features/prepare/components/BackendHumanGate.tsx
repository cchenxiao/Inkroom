import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { Button } from '@/shared/ui';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import { trialApi } from '../api/backend';
import type { BackendRun, HumanAction } from '../types/backend';

export default function BackendHumanGate({
  run,
  currentVersion,
}: {
  run: BackendRun;
  currentVersion?: number;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<HumanAction | null>(null);
  const [uncertain, setUncertain] = useState<HumanAction | null>(null);
  const mutation = useMutation({
    mutationFn: (action: HumanAction) => trialApi.action(run.id, action),
    retry: false,
    onSuccess: (next) => {
      client.setQueryData(['backend-trial', run.id], next);
      setDraft(null);
      setUncertain(null);
    },
    onError: (error, _action) => {
      if (error instanceof ApiError && error.status < 500) setUncertain(null);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['backend-trial', run.id] });
      void client.invalidateQueries({ queryKey: ['backend-draft'] });
      void client.invalidateQueries({ queryKey: ['backend-runs'] });
    },
  });
  const current = currentVersion === run.draftVersion;
  const waiting = run.status === 'waiting_human' && current;
  const locked = mutation.isPending || !!uncertain || !waiting;
  const submit = (action: HumanAction) => {
    setUncertain(action);
    mutation.mutate(action);
  };
  const begin = (type: HumanAction['type']) => {
    mutation.reset();
    const segment = run.result?.segments[0];
    setDraft({
      id: crypto.randomUUID(),
      type,
      draftVersion: run.draftVersion,
      ...(type === 'inline_edit'
        ? { segmentId: segment?.id, text: segment?.text }
        : { instruction: '' }),
    });
  };
  return (
    <section className="page-stack backend-human-gate">
      <h3>
        {t.humanGate} · v{run.draftVersion}
      </h3>
      <p>{t.humanGateNote}</p>
      {!current && <p role="alert">{t.staleResult}</p>}
      {run.status === 'approved' ? (
        <p role="status">{t.approved}</p>
      ) : (
        <>
          <div className="page-actions">
            <Button
              variant="human"
              disabled={locked || !!run.approvalBlock}
              disabledReason={run.approvalBlock || t.actionPending}
              onClick={() =>
                submit({ id: crypto.randomUUID(), type: 'approve', draftVersion: run.draftVersion })
              }
            >
              {t.approveCandidate}
            </Button>
            <Button
              disabled={locked || !!run.instructionBlock}
              disabledReason={run.instructionBlock || t.actionPending}
              onClick={() => begin('instruct')}
            >
              {t.instructCandidate}
            </Button>
            <Button
              disabled={locked}
              disabledReason={t.actionPending}
              onClick={() => begin('inline_edit')}
            >
              {t.inlineRecheck}
            </Button>
          </div>
          {run.approvalBlock && <p>{run.approvalBlock}</p>}
        </>
      )}
      {draft && (
        <div className="page-stack">
          <p>{draft.type === 'instruct' ? t.instructionHint : t.humanInlineNote}</p>
          <textarea
            className="backend-draft-input"
            rows={draft.type === 'instruct' ? 3 : 7}
            aria-label={draft.type === 'instruct' ? t.instructionText : t.inlineRecheck}
            value={draft.type === 'instruct' ? draft.instruction : draft.text}
            disabled={mutation.isPending || !!uncertain}
            onChange={(e) =>
              setDraft({
                ...draft,
                ...(draft.type === 'instruct'
                  ? { instruction: e.target.value }
                  : { text: e.target.value }),
              })
            }
          />
          <Button
            disabled={
              locked ||
              draft.draftVersion !== currentVersion ||
              !(draft.type === 'instruct' ? draft.instruction : draft.text)?.trim()
            }
            disabledReason={t.actionPending}
            onClick={() => submit(draft)}
          >
            {t.submitHuman} · v{draft.draftVersion}
          </Button>
          <Button
            disabled={mutation.isPending || !!uncertain}
            disabledReason={t.actionUncertain}
            onClick={() => setDraft(null)}
          >
            {t.cancelEdit}
          </Button>
        </div>
      )}
      {mutation.isError && (
        <p role="alert">
          {mutation.error instanceof ApiError ? mutation.error.message : t.actionUncertain}
        </p>
      )}
      {uncertain && !mutation.isPending && (
        <Button onClick={() => submit(uncertain)}>{t.retryAction}</Button>
      )}
      {(run.status === 'interrupted' || run.status === 'failed') && run.pendingAction && (
        <>
          <p>{t.resumeActionNote}</p>
          <Button
            disabled={!current || mutation.isPending}
            disabledReason={t.staleResult}
            onClick={() => submit(run.pendingAction!)}
          >
            {t.resumeAction}
          </Button>
        </>
      )}
    </section>
  );
}
