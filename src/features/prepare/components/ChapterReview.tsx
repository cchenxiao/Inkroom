import { useWritingPending, useWritingLocked } from '@/shared/lib/pending-writing';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { Button, Badge } from '@/shared/ui';
import { chapterReviewMessages as t } from '@/shared/lib/messages-chapter-review';
import {
  chapterReviewApi,
  type ChapterReviewRequest,
  type ChapterReviewDecision,
  type ChapterReviewJob,
} from '../api/chapter-review';
import type { ChapterAssembly } from '../api/chapter-assembly';

export default function ChapterReview({
  assemblies,
  editing,
}: {
  assemblies: ChapterAssembly[];
  editing: boolean;
}) {
  const [selected, setSelected] = useState('');
  const localEdit = useWritingLocked();
  const a = assemblies.find((a) => a.id === selected) ?? assemblies[0];
  if (!a) return null;
  return (
    <section className="page-stack" aria-label={t.title}>
      <h3>{t.title}</h3>
      <label>
        {t.chooseAssembly}
        <select disabled={localEdit} value={a.id} onChange={(e) => setSelected(e.target.value)}>
          {assemblies.map((x) => (
            <option key={x.id} value={x.id}>
              v{x.version} · {new Date(x.createdAt).toLocaleString('zh-CN')}
            </option>
          ))}
        </select>
      </label>
      <ReviewSession key={a.id} assembly={a} editing={editing} />
    </section>
  );
}
function ReviewSession({ assembly: a, editing }: { assembly: ChapterAssembly; editing: boolean }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState('');
  const localEdit = useWritingLocked();
  const [pending, setPending] = useState<ChapterReviewRequest | null>(null);
  const query = useQuery({
    queryKey: ['chapter-review', a.id],
    queryFn: ({ signal }) => chapterReviewApi.list(a.id, signal),
    retry: false,
    refetchInterval: 2500,
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ['chapter-review', a.id] });
  const start = useMutation({
    mutationFn: chapterReviewApi.start,
    retry: false,
    onSuccess: () => {
      setPending(null);
      setSelected('');
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) setPending(null);
      refresh();
    },
  });
  useWritingPending(Boolean(pending || start.isPending));
  const job = query.data?.jobs.find((j) => j.id === selected) ?? query.data?.jobs[0];
  const running = query.data?.jobs.some((j) => j.status === 'running');
  const blocked = editing
    ? t.editBlock
    : query.isError
      ? t.error
      : !query.data?.current
        ? query.data?.reason || t.loading
        : running
          ? t.busy
          : '';
  return (
    <>
      <p className="muted">{t.note}</p>
      <div className="core-heading">
        <Button
          disabled={!!blocked || !!pending || localEdit}
          disabledReason={blocked || t.uncertainSave}
          loading={start.isPending}
          onClick={() => {
            if (query.data?.jobs.length && !window.confirm(t.rerunWarning)) return;
            const req = {
              requestId: crypto.randomUUID(),
              assemblyId: a.id,
              assemblyVersion: a.version,
              assemblyDigest: a.digest,
            };
            setPending(req);
            start.mutate(req);
          }}
        >
          {query.data?.jobs.length ? t.again : t.start}
        </Button>
        <Button size="sm" onClick={refresh}>
          {t.refresh}
        </Button>
      </div>
      {query.isPending && <p role="status">{t.loading}</p>}
      {blocked && <p role={query.isError ? 'alert' : 'status'}>{blocked}</p>}
      {query.data?.jobs.length === 0 && <p>{t.empty}</p>}
      {start.isError && (
        <p role="alert">
          {start.error instanceof ApiError ? start.error.message : t.uncertainSave}
        </p>
      )}
      {pending && !start.isPending && (
        <>
          <p>{t.uncertainSave}</p>
          <Button onClick={() => start.mutate(pending)}>{t.retry}</Button>
        </>
      )}
      {!!query.data?.jobs.length && (
        <label>
          {t.chooseReview}
          <select
            disabled={localEdit}
            value={job?.id ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {query.data.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {new Date(j.createdAt).toLocaleString('zh-CN')} · {t[j.status]}
              </option>
            ))}
          </select>
        </label>
      )}
      {job && (
        <ReviewResult
          key={job.id}
          job={job}
          blocked={editing || query.isError || start.isPending || !!pending}
          onChange={refresh}
        />
      )}
    </>
  );
}
function ReviewResult({
  job,
  blocked,
  onChange,
}: {
  job: ChapterReviewJob;
  blocked: boolean;
  onChange: () => void;
}) {
  const [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState('');
  const [pending, setPending] = useState<ChapterReviewDecision | null>(null),
    [stale, setStale] = useState(false);
  const [selectedSource, setSelectedSource] = useState('');
  const text = useRef<HTMLDetailsElement>(null);
  const sourceNodes = useRef(new Map<string, HTMLParagraphElement>());
  const save = useMutation({
    mutationFn: (req: ChapterReviewDecision) => chapterReviewApi.decide(job.id, req),
    retry: false,
    onSuccess: () => {
      setPending(null);
      onChange();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) {
        setPending(null);
        setConfirmed('');
        setStale(e.status === 409);
      }
      onChange();
    },
  });
  const current = job.current && !stale && !blocked;
  const confirmationKey = `${job.id}:${job.status}:${job.inputDigest}`;
  const existing = job.decision ?? save.data?.decision;
  useWritingPending(Boolean(pending || (!existing && reason.trim())));
  const decisionBlock = !current
    ? t.sourceChanged
    : job.status === 'running'
      ? t.busy
      : existing
        ? t.notFinal
        : !reason.trim()
          ? t.reasonRequired
          : confirmed !== confirmationKey
            ? t.confirmRequired
            : '';
  const send = (action: ChapterReviewDecision['action']) => {
    const req = {
      requestId: crypto.randomUUID(),
      assemblyVersion: job.input.draftVersion,
      inputDigest: job.inputDigest,
      action,
      reason: reason.trim(),
    };
    setPending(req);
    save.mutate(req);
  };
  const sources = job.input.parts.flatMap((p) => [...p.segments, ...p.facts]);
  return (
    <div className="page-stack">
      <div>
        <Badge>{t[job.status]}</Badge> · v{job.input.draftVersion} · {job.provider}/{job.model}
      </div>
      {job.provider === 'fake' && <p>{t.fake}</p>}
      {!job.current && <p role="alert">{t.sourceChanged}</p>}
      <p role={job.status === 'failed' ? 'alert' : 'status'}>{job.message}</p>
      {job.output?.critics.map((c) => (
        <details open key={c.critic}>
          <summary>
            {c.critic === 'hard_consistency' ? t.hard_consistency : t.ai_taste} ·{' '}
            {c.findings.length}
          </summary>
          {c.status === 'failed' ? (
            <p role="alert">{c.error || t.failed}</p>
          ) : !c.findings.length ? (
            <p>{t.emptyFindings}</p>
          ) : null}
          {c.findings.map((f) => (
            <article className="backend-commit" key={f.id}>
              <Badge>{f.severity}</Badge> <span>{f.requiresHuman ? t.human : ''}</span>
              <blockquote>{f.quote}</blockquote>
              <p>{f.reason}</p>
              <p>
                {t.suggestion}：{f.suggestion}
              </p>
              <p>
                {t.scope}：{f.repairScope}
              </p>
              <details>
                <summary>{t.evidence}</summary>
                {f.evidence.map((e) => (
                  <p key={e.ref}>
                    <span>
                      {sources.find((s) => s.id === e.ref)?.kind === 'fact' ? 'fact' : 'passage'} ·{' '}
                      {e.ref}
                    </span>
                    ：{e.quote}
                  </p>
                ))}
              </details>
              <Button
                size="sm"
                onClick={() => {
                  setSelectedSource(f.segmentId);
                  if (text.current) text.current.open = true;
                  sourceNodes.current
                    .get(f.segmentId)
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }}
              >
                {t.locate}
              </Button>
            </article>
          ))}
        </details>
      ))}
      <details ref={text}>
        <summary>
          {t.text} · v{job.input.draftVersion}
        </summary>
        <div className="backend-candidate">
          {job.input.parts.map((p) => (
            <section key={p.beatId}>
              <h4>{p.title}</h4>
              {p.segments.map((s) => (
                <p
                  key={s.id}
                  ref={(node) => {
                    if (node) sourceNodes.current.set(s.id, node);
                    else sourceNodes.current.delete(s.id);
                  }}
                  className={selectedSource === s.id ? 'border-l-2 border-ai pl-2' : ''}
                >
                  {s.text}
                </p>
              ))}
            </section>
          ))}
        </div>
      </details>
      <details>
        <summary>{t.facts}</summary>
        {job.input.parts.map((p) => (
          <div key={p.beatId}>
            <h4>
              {p.title} · {p.pov} · {p.storyTime}
            </h4>
            {p.facts.map((f) => (
              <p key={f.id}>
                {f.id} · {f.sourceId} v{f.sourceVersion}：{f.text}
              </p>
            ))}
          </div>
        ))}
      </details>
      <details>
        <summary>
          {t.calls} · {job.calls.length}
        </summary>
        {job.calls.map((c) => (
          <p key={c.number} className="mono">
            #{c.number} · {c.role} · {c.phase} · {c.elapsedMs} ms · {c.promptVersion} ·{' '}
            {c.usage?.known
              ? `${c.usage.inputTokens + c.usage.outputTokens} tokens`
              : 'usage unknown'}
          </p>
        ))}
      </details>
      <p className="muted">{t.notFinal}</p>
      {existing ? (
        <p role="status">
          {existing.action === 'approve' ? t.approved : t.requested}：{existing.reason}
          {!job.current ? ` · ${t.sourceChanged}` : ''}
        </p>
      ) : (
        <>
          <label>
            {t.reason}
            <textarea
              value={reason}
              maxLength={800}
              disabled={!current || !!pending}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="outline-check">
            <input
              type="checkbox"
              checked={current && confirmed === confirmationKey}
              disabled={!current || job.status === 'running' || !!pending}
              onChange={(e) => setConfirmed(e.target.checked ? confirmationKey : '')}
            />
            {t.confirm}
          </label>
          {job.approvalBlock && <p>{job.approvalBlock}</p>}
          <div className="core-heading">
            <Button
              variant="human"
              disabled={!!decisionBlock || !!job.approvalBlock || !!pending}
              disabledReason={decisionBlock || job.approvalBlock || t.uncertainSave}
              loading={save.isPending}
              onClick={() => send('approve')}
            >
              {t.approve}
            </Button>
            <Button
              disabled={!!decisionBlock || !!pending}
              disabledReason={decisionBlock || t.uncertainSave}
              onClick={() => send('request_changes')}
            >
              {t.revise}
            </Button>
          </div>
        </>
      )}
      {save.isError && (
        <p role="alert">{save.error instanceof ApiError ? save.error.message : t.uncertainSave}</p>
      )}
      {stale && <p role="alert">{t.sourceChanged}</p>}
      {pending && !save.isPending && (
        <>
          <p>{t.uncertainSave}</p>
          <Button onClick={() => save.mutate(pending)}>{t.retry}</Button>
        </>
      )}
    </div>
  );
}
