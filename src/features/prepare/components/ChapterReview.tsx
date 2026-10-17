import { ContinuityOption } from './continuity-option';
import { ReviewProgress } from './review-progress';
import { textLabel, repairScopeLabels, readableMessage } from '@/shared/lib/business-labels';
import { TechnicalDetails } from '@/shared/ui/technical-details';
import type { ManuscriptInspection } from '@/types/domain/manuscript-view';
import { useWritingPending, useWritingLocked } from '@/shared/lib/pending-writing';
import { useEffect, useRef, useState } from 'react';
import ChapterPublication from './ChapterPublication';
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
  onRead,
  enhancedContinuity,
  onPrepare,
}: {
  assemblies: ChapterAssembly[];
  onPrepare?: () => void;
  enhancedContinuity?: boolean;
  editing: boolean;
  onRead?: (view: ManuscriptInspection) => void;
}) {
  const [selected, setSelected] = useState('');
  const localEdit = useWritingLocked();
  const retained = useRef<ChapterAssembly>();
  const a =
    assemblies.find((a) => a.id === selected) ??
    (selected && retained.current?.id === selected ? retained.current : assemblies[0]);
  useEffect(() => {
    if (a) {
      retained.current = a;
      if (!selected) setSelected(a.id);
    }
  }, [a, selected]);
  const latestId = assemblies[0]?.id;
  useEffect(() => {
    if (onPrepare && latestId && !localEdit) setSelected(latestId);
  }, [onPrepare, latestId, localEdit]);
  if (!a) return null;
  return (
    <section className="page-stack" aria-label={t.title}>
      {!onRead && <h3>{t.title}</h3>}
      <details open={!onRead} hidden={!!onPrepare}>
        <summary>章稿版本 · v{a.version}</summary>
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
      </details>
      <ReviewSession
        key={a.id}
        assembly={a}
        editing={editing}
        onRead={onRead}
        sharedContinuity={enhancedContinuity}
        onPrepare={onPrepare}
      />
    </section>
  );
}
function ReviewSession({
  assembly: a,
  editing,
  onRead,
  sharedContinuity,
  onPrepare,
}: {
  assembly: ChapterAssembly;
  onPrepare?: () => void;
  sharedContinuity?: boolean;
  editing: boolean;
  onRead?: (view: ManuscriptInspection) => void;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState('');
  const localEdit = useWritingLocked();
  const [localContinuity, setLocalContinuity] = useState(false);
  const enhancedContinuity = sharedContinuity ?? localContinuity;
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
    onSuccess: (job) => {
      setPending(null);
      setSelected(job.id);
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) setPending(null);
      refresh();
    },
  });
  useWritingPending(Boolean(pending || start.isPending));
  const retainedJob = useRef<ChapterReviewJob>();
  const job =
    query.data?.jobs.find((j) => j.id === selected) ??
    (selected && retainedJob.current?.id === selected ? retainedJob.current : query.data?.jobs[0]);
  // Pin a viewed review: a new batch in another window must not unmount pending author actions.
  useEffect(() => {
    if (job) {
      retainedJob.current = job;
      if (!selected) setSelected(job.id);
    }
  }, [selected, job]);
  const activeJob = query.data?.jobs.find((j) => j.status === 'running');
  const running = !!activeJob;
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
      {sharedContinuity === undefined && (
        <details className="chapter-check-settings">
          <summary>检查设置</summary>
          <ContinuityOption
            checked={localContinuity}
            onChange={setLocalContinuity}
            disabled={!!running || !!pending || start.isPending || editing || localEdit}
          />
        </details>
      )}
      <ReviewProgress
        run={
          activeJob
            ? {
                status: activeJob.status,
                activeCalls: activeJob.calls,
                activeRoles: activeJob.calls
                  .filter((c) => c.phase === 'started')
                  .map((c) => c.role),
              }
            : undefined
        }
      />
      {onPrepare && query.data && !query.data.current && (
        <section className="writing-next-step" aria-label="整章下一步">
          <strong>正文已更新，请核对最新整章</strong>
          <p>重新保存已采用的段落，再检查整章衔接。旧审核仅保留为历史记录。</p>
          <Button variant="default" disabled={editing || localEdit || running} onClick={onPrepare}>
            核对最新整章
          </Button>
        </section>
      )}
      <details
        open={!onPrepare || !!query.data?.current}
        hidden={!job}
        className="chapter-review-result"
      >
        <summary hidden={!onPrepare || !!query.data?.current}>上次审核记录</summary>
        {job && (
          <ReviewResult
            key={job.id}
            job={job}
            onRead={onRead}
            blocked={
              editing ||
              query.isError ||
              start.isPending ||
              !!pending ||
              !query.data?.jobs.some((j) => j.id === job.id)
            }
            onChange={refresh}
          />
        )}
      </details>
      <section
        hidden={!!onPrepare && !!query.data && !query.data.current}
        className="chapter-review-run"
        aria-label="发起整章复审"
      >
        <p className="muted">
          {enhancedContinuity ? '下次复审将加强核对衔接' : '下次复审核对事实与语言'}
        </p>
        <div className="core-heading">
          <Button
            disabled={!!blocked || !!pending || localEdit}
            disabledReason={blocked || t.uncertainSave}
            loading={start.isPending}
            onClick={() => {
              if (query.data?.jobs.length && !window.confirm(t.rerunWarning)) return;
              const req = {
                enhancedContinuity,
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
      </section>
      <details>
        <summary>
          复审记录{job ? ` · ${job.input.enhancedContinuity ? '含加强衔接检查' : '常规检查'}` : ''}
        </summary>
        <p className="muted">{t.note}</p>
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
      </details>
    </>
  );
}
function ReviewResult({
  job,
  blocked,
  onChange,
  onRead,
}: {
  job: ChapterReviewJob;
  blocked: boolean;
  onChange: () => void;
  onRead?: (view: ManuscriptInspection) => void;
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
  const inspect = (selectedFinding?: string) =>
    onRead?.({
      title: `复审章稿 v${job.input.draftVersion}`,
      parts: job.input.parts.map((p) => ({
        id: p.beatId,
        title: p.title,
        segments: p.segments.map((s) => ({
          id: s.id,
          text: s.text,
          version: job.input.draftVersion,
        })),
      })),
      findings:
        job.output?.critics.flatMap((c) =>
          c.findings.map((f) => ({
            ...f,
            critic: f.critic,
            evidenceRefs: f.evidence.map((e) => e.ref),
            draftVersion: job.input.draftVersion,
            status: 'open' as const,
            replacement: '',
          })),
        ) ?? [],
      selectedFinding,
    });
  return (
    <div className="page-stack">
      <div className="writing-next-step">
        <strong>
          章稿 v{job.input.draftVersion} ·{' '}
          {!job.current
            ? '来源已更新，需重新复审'
            : existing?.action === 'approve'
              ? '复审已通过'
              : t[job.status]}
        </strong>
        <p>
          {!job.current
            ? '下一步：审核并采用当前段落，再重新组稿复审。'
            : existing?.action === 'approve'
              ? '下一步：整理章末事实，确认后定稿。'
              : existing
                ? '下一步：回到正文修改，再保存章稿并复审。'
                : job.status === 'running'
                  ? '正在审读整章，完成后等待你的判断。'
                  : '通读正文与审查意见，然后决定通过或退回修改。'}
        </p>
      </div>
      {job.provider === 'fake' && <p>{t.fake}</p>}
      {!existing && (
        <p role={job.status === 'failed' ? 'alert' : 'status'}>
          {readableMessage(
            job.message,
            job.status === 'running'
              ? '正在审读整章…'
              : '请核对本次审读结果；异常信息可在技术详情中查看。',
          )}
        </p>
      )}
      {onRead && (
        <Button size="sm" onClick={() => inspect()}>
          在正文区查看复审稿
        </Button>
      )}
      <details
        open={
          !onRead || job.output?.critics.some((c) => c.status === 'failed' || c.findings.length > 0)
        }
      >
        <summary>
          审查意见与依据 · {job.output?.critics.reduce((n, c) => n + c.findings.length, 0) ?? 0}{' '}
          个问题
        </summary>
        {job.output?.critics.map((c) => (
          <details open={!!c.findings.length || c.status === 'failed'} key={c.critic}>
            <summary>
              {c.critic === 'hard_consistency' ? t.hard_consistency : t.ai_taste} ·{' '}
              {c.findings.length}
            </summary>
            {c.status === 'failed' ? (
              <p role="alert">{readableMessage(c.error, t.failed)}</p>
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
                  {t.scope}：{repairScopeLabels[f.repairScope] ?? '请结合意见确认修改范围'}
                </p>
                <details>
                  <summary>{t.evidence}</summary>
                  {f.evidence.map((e) => (
                    <p key={e.ref}>
                      <span>
                        {sources.find((s) => s.id === e.ref)?.kind === 'fact'
                          ? '已确认事实'
                          : '原文证据'}{' '}
                        · {textLabel(e.quote, '证据内容暂缺')}
                      </span>
                      ：{e.quote}
                    </p>
                  ))}
                </details>
                <Button
                  size="sm"
                  onClick={() => {
                    if (onRead) {
                      inspect(f.id);
                      return;
                    }
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
        <details ref={text} hidden={!!onRead}>
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
                  来源版本 v{f.sourceVersion}：{f.text}
                </p>
              ))}
            </div>
          ))}
        </details>
        <TechnicalDetails
          items={{
            复审批次编号: job.id,
            状态说明原文:
              readableMessage(job.message, '') === job.message ? undefined : job.message,
            评审错误原文: job.output?.critics
              .map((c) => c.error)
              .filter(Boolean)
              .join('；'),
          }}
        />
        <details>
          <summary>
            {t.calls} · {job.calls.length}
          </summary>
          <p>
            {job.provider} / {job.model}
          </p>
          {job.calls.map((c) => (
            <p key={c.number} className="mono">
              #{c.number} · {c.role} · {c.phase} · {c.elapsedMs} ms · {c.promptVersion} ·{' '}
              {c.usage?.known
                ? `${c.usage.inputTokens + c.usage.outputTokens} tokens`
                : 'usage unknown'}
            </p>
          ))}
        </details>
      </details>
      {!existing && job.current && <p className="muted">{t.notFinal}</p>}
      {existing ? (
        <details>
          <summary>{existing.action === 'approve' ? t.approved : t.requested}</summary>
          <p role="status">
            {existing.reason}
            {!job.current ? ` · ${t.sourceChanged}` : ''}
          </p>
        </details>
      ) : (
        <div hidden={!!onRead && !job.current && !pending && !reason}>
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
              variant="default"
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
        </div>
      )}
      {existing?.action === 'approve' && (
        <details open={!onRead || job.current}>
          <summary>{job.current ? '章末事实与定稿' : '历史定稿信息（来源已更新）'}</summary>
          <ChapterPublication
            job={{ ...job, decision: existing }}
            blocked={blocked || stale || !!pending || save.isPending}
          />
        </details>
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
