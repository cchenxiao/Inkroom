import { TechnicalDetails } from '@/shared/ui/technical-details';
import './chapter-review.css';
import { useEffect, useRef, useState } from 'react';
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
  continuation,
}: {
  job: ChapterReviewJob;
  blocked: boolean;
  continuation?: { label: string; onClick: () => void };
}) {
  const client = useQueryClient();
  const [step, setStep] = useState<'facts' | 'confirm'>('facts');
  const heading = useRef<HTMLDivElement>(null);
  const goTo = (next: 'facts' | 'confirm') => {
    setStep(next);
    heading.current?.scrollIntoView({ block: 'nearest' });
  };
  useEffect(() => {
    heading.current?.scrollIntoView({ block: 'nearest' });
  }, []);
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
      void client.invalidateQueries({ queryKey: ['live-book'] });
      void client.invalidateQueries({ queryKey: ['book-archive'] });
      void client.invalidateQueries({ queryKey: ['planned-run-gate'] });
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
    <section className="page-stack chapter-publication-workbench" aria-label={t.title}>
      <div ref={heading} className="chapter-publication-heading">
        {!receipt && (
          <div className="chapter-review-tabs" role="group" aria-label="定稿操作">
            <button aria-pressed={step === 'facts'} onClick={() => goTo('facts')}>
              1 核对事实
            </button>
            <button aria-pressed={step === 'confirm'} onClick={() => goTo('confirm')}>
              2 确认定稿
            </button>
          </div>
        )}
        {receipt && <h3>{t.title}</h3>}
      </div>
      {receipt && <p role="status">{t.localFacts}</p>}
      {factsQuery.isError && <p role="alert">{t.error}</p>}
      {/* Keep local decisions and uncertain retries mounted if another window publishes. */}
      <details className="chapter-publication-fact-record" open={!receipt}>
        <summary hidden={!receipt}>已保存的事实决定</summary>
        <div hidden={!receipt && step !== 'facts'} className="chapter-publication-facts">
          <ChapterFacts
            review={job}
            state={factsQuery.data}
            blocked={
              blocked || stale || factsQuery.isError || !!pending || save.isPending || !!receipt
            }
            onChange={refresh}
          />
          {!receipt && !factsQuery.isPending && !factsQuery.isError && !factsQuery.data?.job && (
            <p className="muted">如果核对后确认没有新增事实或冲突，可直接进入确认定稿。</p>
          )}
          {!receipt && <Button onClick={() => goTo('confirm')}>继续：确认定稿</Button>}
        </div>
      </details>
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
          {current && continuation && (
            <Button
              variant="default"
              disabled={blocked || otherEdits || !!pending}
              onClick={continuation.onClick}
            >
              {continuation.label}
            </Button>
          )}
          <p className="muted">{t.next}</p>
        </>
      ) : (
        <section
          className="chapter-review-decision"
          aria-label="确认整章定稿"
          hidden={step !== 'confirm'}
        >
          <strong>确认本章定稿</strong>
          <p className="muted">{t.note}</p>
          {factsQuery.data?.selection && (
            <p>
              已保存事实决定 · {factsQuery.data.selection.package.facts.length}{' '}
              条新增事实将供后续章节使用。
            </p>
          )}
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
          {(factsQuery.data?.block || choice === 'pending' || otherEdits) && (
            <Button onClick={() => goTo('facts')}>返回核对事实</Button>
          )}
          <Button
            variant="human"
            className="chapter-publication-submit"
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
        </section>
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
