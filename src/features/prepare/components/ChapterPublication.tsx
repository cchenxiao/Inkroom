import { TechnicalDetails } from '@/shared/ui/technical-details';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { useWritingPending } from '@/shared/lib/pending-writing';
import { chapterPublicationMessages as t } from '@/shared/lib/messages-chapter-publication';
import { Button, Badge } from '@/shared/ui';
import { chapterPublicationApi, type ChapterPublicationRequest } from '../api/chapter-publication';
import ChapterFacts from './ChapterFacts';
import { chapterFactsApi } from '../api/chapter-facts';
import type { ChapterReviewJob } from '../api/chapter-review';

export default function ChapterPublication({
  job,
  blocked,
}: {
  job: ChapterReviewJob;
  blocked: boolean;
}) {
  const client = useQueryClient();
  const [choice, setChoice] = useState('');
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<ChapterPublicationRequest | null>(null);
  const key = ['chapter-publication', job.id];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => chapterPublicationApi.read(job.id, signal),
    retry: false,
    refetchInterval: 2500,
  });
  const factsQuery = useQuery({
    queryKey: ['chapter-facts', job.id],
    queryFn: ({ signal }) => chapterFactsApi.read(job.id, signal),
    retry: false,
    refetchInterval: 2500,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: ['chapter-facts', job.id] });
  };
  const factToken = `${factsQuery.data?.job?.id ?? ''}:${factsQuery.data?.job?.status ?? ''}:${factsQuery.data?.selection?.version ?? 0}`;
  useEffect(() => {
    setChoice('');
  }, [factToken]);

  const save = useMutation({
    mutationFn: chapterPublicationApi.publish,
    retry: false,
    onSuccess: (data) => {
      client.setQueryData(key, data);
      setPending(null);
      setChoice('');
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) {
        setPending(null);
        setChoice('');
        setStale(e.status === 409);
      }
      refresh();
    },
  });
  const receipt = query.data?.publication;
  const otherEdits = useWritingPending(Boolean(pending || save.isPending));
  // Reading a receipt can recover a write whose response was lost without resending it.
  useEffect(() => {
    if (receipt && pending?.requestId === receipt.request.requestId) {
      setPending(null);
      setChoice('');
    }
  }, [receipt, pending]);
  const sourceCurrent = job.current;
  useEffect(() => {
    if (!sourceCurrent) setChoice('');
  }, [sourceCurrent]);
  const approval = job.decision?.action === 'approve' ? job.decision.requestId : '';
  const gate =
    !job.current || stale
      ? t.changed
      : otherEdits
        ? t.otherEdits
        : blocked || job.approvalBlock || job.status !== 'completed' || !approval
          ? job.approvalBlock || t.gate
          : query.isError || factsQuery.isError
            ? t.error
            : query.isPending || factsQuery.isPending
              ? t.loading
              : factsQuery.data?.block || '';
  const reason =
    gate || (choice === 'pending' ? t.factsBlocked : choice !== 'none' ? t.factsRequired : '');
  const current = query.data?.current && job.current;
  return (
    <section className="page-stack" aria-label={t.title}>
      <h3>{t.title}</h3>
      {!receipt && <p className="muted">{t.note}</p>}
      {receipt && <p role="status">{t.localFacts}</p>}
      {factsQuery.isError && <p role="alert">{t.error}</p>}
      {/* Keep local decisions and uncertain retries mounted if another window publishes. */}
      <ChapterFacts
        review={job}
        state={factsQuery.data}
        blocked={blocked || stale || factsQuery.isError || !!pending || save.isPending || !!receipt}
        onChange={refresh}
      />
      {receipt ? (
        <>
          <Badge tone={current ? 'success' : 'muted'}>{current ? t.saved : t.historical}</Badge>
          {!current && <p role="status">{query.data?.reason || t.changed}</p>}
          {query.isError && <p role="alert">{t.error}</p>}
          <p>
            {t.version} {receipt.version} · {t.assembly} v{receipt.assembly.version} ·{' '}
            {new Date(receipt.createdAt).toLocaleString('zh-CN')}
          </p>
          <details>
            <summary>{t.receipt}</summary>
            <TechnicalDetails items={{ 定稿记录编号: receipt.id }} />
            <p>{receipt.factSelection ? t.reviewedFacts : t.authorFacts}</p>
            {receipt.factSelection?.package.facts.map((f) => (
              <p key={f.id}>
                {f.text} · {f.knownBy.join('、') || t.noKnowers}
              </p>
            ))}
          </details>
          <p className="muted">{t.next}</p>
        </>
      ) : (
        <>
          {query.isPending ? (
            <p role="status">{t.loading}</p>
          ) : (
            <fieldset disabled={!!gate || !!pending || save.isPending}>
              <legend>{t.facts}</legend>
              <label className="outline-check">
                <input
                  type="radio"
                  name={`facts-${job.id}`}
                  checked={!gate && choice === 'none'}
                  onChange={() => setChoice('none')}
                />
                {t.none}
              </label>
              <label className="outline-check">
                <input
                  type="radio"
                  name={`facts-${job.id}`}
                  checked={!gate && choice === 'pending'}
                  onChange={() => setChoice('pending')}
                />
                {t.pending}
              </label>
            </fieldset>
          )}
          {reason && <p role={query.isError ? 'alert' : 'status'}>{reason}</p>}
          <Button
            variant="human"
            loading={save.isPending}
            disabled={!!reason || !!pending || !!receipt}
            disabledReason={reason || t.uncertain}
            onClick={() => {
              const req: ChapterPublicationRequest = {
                requestId: crypto.randomUUID(),
                reviewId: job.id,
                assemblyVersion: job.input.draftVersion,
                inputDigest: job.inputDigest,
                approvalId: approval,
                noPendingFacts: true,
                ...(factsQuery.data?.job
                  ? {
                      factJobId: factsQuery.data.job.id,
                      factVersion: factsQuery.data.selection?.version ?? 0,
                    }
                  : {}),
              };
              setPending(req);
              save.mutate(req);
            }}
          >
            {t.publish}
          </Button>
        </>
      )}
      {save.isError && (
        <p role="alert">{save.error instanceof ApiError ? save.error.message : t.uncertain}</p>
      )}
      {pending && !save.isPending && (
        <>
          <p>{t.uncertain}</p>
          <Button onClick={() => save.mutate(pending)}>{t.retry}</Button>
        </>
      )}
      <Button size="sm" onClick={refresh}>
        {t.refresh}
      </Button>
    </section>
  );
}
