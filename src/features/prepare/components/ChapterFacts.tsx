import { textLabel, readableMessage } from '@/shared/lib/business-labels';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { useWritingPending, useWritingLocked } from '@/shared/lib/pending-writing';
import { Button, Badge, Modal } from '@/shared/ui';
import { chapterFactsMessages as t } from '@/shared/lib/messages-chapter-facts';
import {
  chapterFactsApi,
  type FactCandidate,
  type FactDecision,
  type FactsJob,
  type FactsRequest,
  type FactsSelection,
  type FactsSelectionRequest,
  type FactsState,
} from '../api/chapter-facts';
import type { ChapterReviewJob } from '../api/chapter-review';

export default function ChapterFacts({
  review,
  state,
  blocked,
  onChange,
}: {
  review: ChapterReviewJob;
  state?: FactsState;
  blocked: boolean;
  onChange: () => void;
}) {
  const [pending, setPending] = useState<FactsRequest | null>(null);
  const [restartMode, setRestartMode] = useState<FactsRequest['mode'] | null>(null);
  const [pinned, setPinned] = useState('');
  const previous = useRef<FactsJob>();
  const latest = state?.job;
  const job = latest?.id === pinned || !pinned ? latest : previous.current;
  useEffect(() => {
    if (job) {
      previous.current = job;
      if (!pinned) setPinned(job.id);
    }
  }, [job, pinned]);
  const locked = useWritingLocked();
  const start = useMutation({
    mutationFn: chapterFactsApi.start,
    retry: false,
    onSuccess: (j) => {
      setPending(null);
      setPinned(j.id);
      onChange();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) setPending(null);
      onChange();
    },
  });
  useWritingPending(Boolean(pending || start.isPending));
  const disabled =
    blocked || locked || !state?.current || state.published || latest?.status === 'running';
  const begin = (mode: FactsRequest['mode'], confirmed = false) => {
    if (disabled) return;
    if (latest && !confirmed) {
      setRestartMode(mode);
      return;
    }
    const req = {
      requestId: crypto.randomUUID(),
      reviewId: review.id,
      inputDigest: review.inputDigest,
      mode,
    };
    setPending(req);
    start.mutate(req);
  };
  return (
    <section className="page-stack" aria-label={t.title}>
      <Modal
        open={!!restartMode}
        onOpenChange={(open) => {
          if (!open) setRestartMode(null);
        }}
        title="重新整理本章事实"
        description={t.restart}
        footer={
          <Button
            disabled={disabled}
            onClick={() => {
              if (restartMode) begin(restartMode, true);
              setRestartMode(null);
            }}
          >
            确认并继续
          </Button>
        }
      >
        {null}
      </Modal>
      <h4>{t.title}</h4>
      <p className="muted">{t.note}</p>
      <div className="core-heading">
        <Button disabled={disabled} disabledReason={t.editBlock} onClick={() => begin('model')}>
          {t.model}
        </Button>
        <Button disabled={disabled} disabledReason={t.editBlock} onClick={() => begin('manual')}>
          {t.manual}
        </Button>
      </div>
      {start.isError && (
        <p role="alert">{start.error instanceof ApiError ? start.error.message : t.unknown}</p>
      )}
      {pending && !start.isPending && (
        <Button onClick={() => start.mutate(pending)}>{t.retry}</Button>
      )}
      {job && (
        <>
          <p role="status">
            {job.status === 'running'
              ? t.busy
              : readableMessage(job.message, '请核对本次事实整理结果。')}
          </p>
          {job.provider === 'human' && <p>{t.noModel}</p>}
          {job.provider === 'fake' && <p>{t.fake}</p>}
          {latest?.id !== job.id && (
            <>
              <p role="alert">{t.stale}</p>
              <Button
                disabled={locked}
                disabledReason={t.editBlock}
                onClick={() => setPinned(latest?.id ?? '')}
              >
                {t.latest}
              </Button>
            </>
          )}
          {job.output && (
            <FactEditor
              key={job.id}
              job={job}
              selection={latest?.id === job.id ? state?.selection : null}
              blocked={
                blocked ||
                !state?.current ||
                !!state.published ||
                latest?.id !== job.id ||
                !!pending
              }
              onChange={onChange}
            />
          )}
          <details>
            <summary>{t.audit}</summary>
            <p className="mono">
              {job.id} · {job.provider} · {job.calls.length} calls
            </p>
            {job.calls.map((c) => (
              <p key={c.number}>
                {c.role} · {c.phase} · {c.elapsedMs} ms · {c.promptVersion}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
function FactEditor({
  job,
  selection,
  blocked,
  onChange,
}: {
  job: FactsJob;
  selection?: FactsSelection | null;
  blocked: boolean;
  onChange: () => void;
}) {
  const [decisions, setDecisions] = useState<FactDecision[]>(selection?.request.decisions ?? []);
  const [manual, setManual] = useState<FactCandidate[]>(selection?.request.manual ?? []);
  const [baseVersion, setBaseVersion] = useState(selection?.version ?? 0);
  const [dirty, setDirty] = useState(false),
    [stale, setStale] = useState(false);
  const [pending, setPending] = useState<FactsSelectionRequest | null>(null);
  const save = useMutation({
    mutationFn: chapterFactsApi.save,
    retry: false,
    onSuccess: (s) => {
      setPending(null);
      setDirty(false);
      setBaseVersion(s.version);
      setDecisions(s.request.decisions);
      setManual(s.request.manual);
      onChange();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) {
        setPending(null);
        setStale(e.status === 409);
      }
      onChange();
    },
  });
  const otherPending = useWritingPending(Boolean(dirty || pending || save.isPending));
  // Polls never replace unsaved author decisions; their original base version stays frozen.
  useEffect(() => {
    if (!dirty && !pending && (selection?.version ?? 0) >= baseVersion) {
      setDecisions(selection?.request.decisions ?? []);
      setManual(selection?.request.manual ?? []);
      setBaseVersion(selection?.version ?? 0);
    }
  }, [selection, dirty, pending, baseVersion]);
  const locked = blocked || !!pending || otherPending;
  const candidates = [...(job.output?.candidates ?? []), ...manual];
  const sources = job.input.review.parts.flatMap((p) => p.segments);
  const change = (id: string, update: Partial<FactDecision>) => {
    setDirty(true);
    setDecisions((old) => {
      const existing = old.find((d) => d.candidateId === id) ?? {
        candidateId: id,
        action: 'exclude',
        text: candidates.find((c) => c.id === id)?.text ?? '',
        knownBy: [],
        reason: '',
      };
      return [...old.filter((d) => d.candidateId !== id), { ...existing, ...update }];
    });
  };
  const editManual = (id: string, patch: Partial<FactCandidate>) => {
    setDirty(true);
    setManual((old) => old.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setDecisions((old) => old.filter((d) => d.candidateId !== id));
  };
  return (
    <div className="page-stack">
      {!candidates.length && (
        <p>
          {job.request.mode === 'manual'
            ? '尚未补充事实。请核对正文后添加，或确认本章没有新增事实。'
            : t.empty}
        </p>
      )}
      {candidates.map((c, i) => {
        const d = decisions.find((d) => d.candidateId === c.id);
        const isManual = manual.some((m) => m.id === c.id);
        const existing = job.input.knowledge.facts.find((f) => f.id === c.relatedFactId);
        return (
          <article key={c.id} className="backend-commit page-stack">
            <div>
              <Badge>
                {t.candidate} {i + 1}
              </Badge>{' '}
              · {t[c.kind]}
            </div>
            {isManual ? (
              <>
                <label>
                  {t.source}
                  <select
                    disabled={locked}
                    value={c.evidence.ref}
                    onChange={(e) => {
                      const s = sources.find((s) => s.id === e.target.value);
                      editManual(c.id, { evidence: { ref: e.target.value, quote: s?.text ?? '' } });
                    }}
                  >
                    <option value="">—</option>
                    {sources.map((s, index) => (
                      <option key={s.id} value={s.id}>
                        原文 {index + 1} · {textLabel(s.text, '原文内容暂缺', 40)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.quote}
                  <textarea
                    readOnly={locked}
                    value={c.evidence.quote}
                    onChange={(e) =>
                      editManual(c.id, { evidence: { ...c.evidence, quote: e.target.value } })
                    }
                  />
                </label>
                <label>
                  {t.text}
                  <textarea
                    readOnly={locked}
                    maxLength={500}
                    value={c.text}
                    onChange={(e) => editManual(c.id, { text: e.target.value })}
                  />
                </label>
                <label>
                  {t.related}
                  <select
                    disabled={locked}
                    value={c.relatedFactId}
                    onChange={(e) => editManual(c.id, { relatedFactId: e.target.value })}
                  >
                    <option value="">{t.noRelated}</option>
                    {job.input.knowledge.facts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.text}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    setDirty(true);
                    setManual(manual.filter((m) => m.id !== c.id));
                    setDecisions(decisions.filter((d) => d.candidateId !== c.id));
                  }}
                >
                  {t.remove}
                </Button>
              </>
            ) : (
              <>
                <p>{c.text}</p>
                <blockquote>{c.evidence.quote}</blockquote>
                <p className="muted">
                  {c.evidence.ref} · {c.reason}
                </p>
              </>
            )}
            {existing && (
              <>
                <p>{t.conflict}</p>
                <blockquote>{existing.text}</blockquote>
              </>
            )}
            {c.kind !== 'event' && <p>{t.statementNote}</p>}
            <label>
              {t.candidate} {i + 1} · {t.reason}
              <select
                disabled={locked}
                value={d?.action ?? ''}
                onChange={(e) => change(c.id, { action: e.target.value as FactDecision['action'] })}
              >
                <option value="" disabled>
                  {t.pending}
                </option>
                <option value="confirm" disabled={c.kind !== 'event' || !!c.relatedFactId}>
                  {t.confirm}
                </option>
                <option value="exclude">{t.exclude}</option>
                <option value="keep_existing" disabled={!c.relatedFactId}>
                  {t.keep_existing}
                </option>
                <option value="revise_manuscript">{t.revise_manuscript}</option>
              </select>
            </label>
            {d?.action === 'confirm' && (
              <>
                <label>
                  {t.text}
                  <textarea
                    readOnly={locked}
                    maxLength={500}
                    value={d.text}
                    onChange={(e) => change(c.id, { text: e.target.value })}
                  />
                </label>
                <fieldset disabled={locked}>
                  <legend>{t.known}</legend>
                  {job.input.knowledge.characters.map((id) => (
                    <label key={id} className="outline-check">
                      <input
                        type="checkbox"
                        checked={d.knownBy.includes(id)}
                        onChange={(e) =>
                          change(c.id, {
                            knownBy: e.target.checked
                              ? [...d.knownBy, id]
                              : d.knownBy.filter((x) => x !== id),
                          })
                        }
                      />
                      {id}
                    </label>
                  ))}
                </fieldset>
                <p className="muted">{t.knownNote}</p>
              </>
            )}
            {d && (
              <label>
                {t.reason}
                <input
                  readOnly={locked}
                  value={d.reason}
                  maxLength={500}
                  onChange={(e) => change(c.id, { reason: e.target.value })}
                />
              </label>
            )}
          </article>
        );
      })}
      <Button
        size="sm"
        disabled={locked || manual.length >= 8}
        onClick={() => {
          setDirty(true);
          setManual([
            ...manual,
            {
              id: `manual-${crypto.randomUUID()}`,
              text: '',
              kind: 'event',
              relatedFactId: '',
              evidence: { ref: '', quote: '' },
              reason: '作者补充',
            },
          ]);
        }}
      >
        {t.add}
      </Button>
      {selection && (
        <p>
          {t.saved} · v{selection.version} · {selection.package.facts.length} 条新增事实
        </p>
      )}
      {selection?.block && <p role="status">{selection.block}</p>}
      {dirty && <p>{t.draft}</p>}
      {(stale || baseVersion !== (selection?.version ?? 0)) && <p role="alert">{t.stale}</p>}
      <div className="core-heading">
        <Button
          disabled={
            locked ||
            stale ||
            baseVersion !== (selection?.version ?? 0) ||
            decisions.some((d) => !d.reason.trim())
          }
          disabledReason={t.editBlock}
          loading={save.isPending}
          onClick={() => {
            const req = {
              requestId: crypto.randomUUID(),
              jobId: job.id,
              expectedVersion: baseVersion,
              manual,
              decisions,
            };
            setPending(req);
            save.mutate(req);
          }}
        >
          {t.save}
        </Button>
        <Button
          disabled={!!pending || save.isPending}
          onClick={() => {
            setDirty(false);
            setStale(false);
            setDecisions(selection?.request.decisions ?? []);
            setManual(selection?.request.manual ?? []);
            setBaseVersion(selection?.version ?? 0);
          }}
        >
          {t.cancel}
        </Button>
      </div>
      {save.isError && (
        <p role="alert">{save.error instanceof ApiError ? save.error.message : t.unknown}</p>
      )}
      {pending && !save.isPending && (
        <Button onClick={() => save.mutate(pending)}>{t.retrySave}</Button>
      )}
    </div>
  );
}
