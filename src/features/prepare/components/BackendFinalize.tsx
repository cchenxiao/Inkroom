import { TechnicalDetails } from '@/shared/ui/technical-details';
import { useWritingPending } from '@/shared/lib/pending-writing';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { Badge, Button } from '@/shared/ui';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import { plannedRunMessages as plannedText } from '@/shared/lib/messages-planned-run';
import { trialApi } from '../api/backend';
import { refreshEventQueries } from '../api/refresh-events';
import type { BackendRun, FinalizeInput } from '../types/backend';

export default function BackendFinalize({
  run,
  currentVersion,
  chapterId = 'ch7',
}: {
  run: BackendRun;
  currentVersion?: number;
  chapterId?: string;
}) {
  const client = useQueryClient();
  const [confirmedVersion, setConfirmedVersion] = useState<number | null>(null);
  const [uncertain, setUncertain] = useState<FinalizeInput | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useQuery({
    queryKey: chapterId === 'ch7' ? ['backend-commits'] : ['backend-commits', chapterId],
    queryFn: ({ signal }) => trialApi.commits(signal, chapterId),
    enabled: historyOpen || !!run.commitId,
    retry: false,
  });
  const submit = useMutation({
    mutationFn: (input: FinalizeInput) => trialApi.finalize(run.id, input),
    retry: false,
    onSuccess: () => {
      setUncertain(null);
      setHistoryOpen(true);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) setUncertain(null);
    },
    onSettled: () => {
      void refreshEventQueries(client, [
        ['backend-trial', run.id],
        ['backend-commits'],
        ['backend-runs'],
        ['chapter-assembly'],
      ]);
    },
  });
  useWritingPending(Boolean(uncertain || submit.isPending));
  const current = currentVersion === run.draftVersion;
  const blocked = !run.inputDigest
    ? t.legacyContext
    : !current || run.status === 'stale'
      ? t.staleResult
      : run.status !== 'approved'
        ? t.approveBeforeCommit
        : run.approvalBlock;
  const confirmed = confirmedVersion === run.draftVersion;
  const save = (input: FinalizeInput) => {
    setUncertain(input);
    submit.mutate(input);
  };
  return (
    <section className="backend-finalize page-stack">
      <h3>{run.planning ? plannedText.finalizeTitle : t.finalizeTitle}</h3>
      <p>{run.planning ? plannedText.finalizeNote : t.finalizeNote}</p>
      {run.commitId ? (
        <p role="status">
          {t.committed} · 候选 v{run.draftVersion}
        </p>
      ) : (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!!blocked || submit.isPending || !!uncertain}
              onChange={(e) => setConfirmedVersion(e.target.checked ? run.draftVersion : null)}
            />
            {t.confirmFacts}
          </label>
          <Button
            variant="human"
            loading={submit.isPending}
            disabled={!!blocked || !confirmed || !!uncertain}
            disabledReason={blocked || (uncertain ? t.commitUncertain : t.confirmFactsRequired)}
            onClick={() =>
              save({
                id: crypto.randomUUID(),
                draftVersion: run.draftVersion,
                inputDigest: run.inputDigest!,
                factsConfirmed: true,
              })
            }
          >
            {run.planning ? plannedText.finalizeAction : t.finalizeAction} · v{run.draftVersion}
          </Button>
          {blocked && <p>{blocked}</p>}
          {uncertain && !submit.isPending && (
            <>
              <p role="alert">{t.commitUncertain}</p>
              <Button onClick={() => save(uncertain)}>{t.retryAction}</Button>
            </>
          )}
        </>
      )}
      {submit.isError && (
        <p role="alert">
          {submit.error instanceof ApiError ? submit.error.message : t.commitUncertain}
        </p>
      )}
      <details open={historyOpen} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
        <summary>{t.finalHistory}</summary>
        {history.isPending && <p>{t.loadDraft}</p>}
        {history.isError && <Button onClick={() => void history.refetch()}>{t.retry}</Button>}
        {history.data?.length === 0 && <p>{t.noCommits}</p>}
        {history.data?.map((commit) => (
          <details className="backend-commit" key={commit.id}>
            <summary>
              <Badge tone="human">v{commit.draftVersion}</Badge>{' '}
              {new Date(commit.createdAt).toLocaleString('zh-CN')}
            </summary>
            <div className="backend-candidate">
              {commit.segments.map((segment) => (
                <p key={segment.id}>{segment.text}</p>
              ))}
            </div>
            <p>
              {t.frozenRefs} {commit.refs.length} · {t.authorFactsConfirmed}
            </p>
            <p>{commit.parentCommit ? '延续上一份已保存版本' : t.firstCommit}</p>
            {commit.refs.map((ref, index) => (
              <p key={`${ref.kind}:${ref.id}`}>
                <Badge>{t.sourceKinds[ref.kind] ?? '创作材料'}</Badge> {index + 1} · v{ref.version}
              </p>
            ))}
            <TechnicalDetails
              items={{
                提交编号: commit.id,
                上一提交编号: commit.parentCommit,
                来源记录: commit.refs.map((ref) => `${ref.id} · ${ref.digest}`).join('；'),
              }}
            />
          </details>
        ))}
      </details>
    </section>
  );
}
