import './chapter-review.css';
import { ContinuityOption } from './continuity-option';
import { ReviewProgress } from './review-progress';
import { textLabel, repairScopeLabels, readableMessage } from '@/shared/lib/business-labels';
import { TechnicalDetails } from '@/shared/ui/technical-details';
import type { ManuscriptInspection } from '@/types/domain/manuscript-view';
import { useWritingPending, useWritingLocked } from '@/shared/lib/pending-writing';
import { useEffect, useRef, useState } from 'react';
import ChapterPublication from './ChapterPublication';
import { chapterPublicationApi } from '../api/chapter-publication';
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
  continuation,
  enhancedContinuity,
  onPrepare,
  onPhase,
}: {
  onPhase?: (phase: 'review' | 'finalize' | 'done') => void;
  assemblies: ChapterAssembly[];
  onPrepare?: () => void;
  enhancedContinuity?: boolean;
  editing: boolean;
  onRead?: (view: ManuscriptInspection) => void;
  continuation?: { label: string; onClick: () => void };
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
        continuation={continuation}
        sharedContinuity={enhancedContinuity}
        onPrepare={onPrepare}
        onPhase={onPhase}
      />
    </section>
  );
}
function ReviewSession({
  assembly: a,
  editing,
  onRead,
  continuation,
  sharedContinuity,
  onPrepare,
  onPhase,
}: {
  onPhase?: (phase: 'review' | 'finalize' | 'done') => void;
  assembly: ChapterAssembly;
  onPrepare?: () => void;
  sharedContinuity?: boolean;
  editing: boolean;
  onRead?: (view: ManuscriptInspection) => void;
  continuation?: { label: string; onClick: () => void };
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
  const failed = job?.status === 'failed' || job?.status === 'interrupted';
  const beginReview = () => {
    if (blocked || pending || localEdit || start.isPending) return;
    if (!failed && query.data?.jobs.length && !window.confirm(t.rerunWarning)) return;
    const req = {
      enhancedContinuity,
      requestId: crypto.randomUUID(),
      assemblyId: a.id,
      assemblyVersion: a.version,
      assemblyDigest: a.digest,
    };
    setPending(req);
    start.mutate(req);
  };
  const publication = useQuery({
    queryKey: ['chapter-publication', job?.id],
    queryFn: ({ signal }) => chapterPublicationApi.read(job!.id, signal),
    enabled: !!job?.current && job.decision?.action === 'approve',
    retry: false,
  });
  const phase =
    !query.data?.current || !job?.current
      ? 'review'
      : publication.data?.current
        ? 'done'
        : job.decision?.action === 'approve'
          ? 'finalize'
          : 'review';
  useEffect(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);
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
            continuation={continuation}
            finalized={phase === 'done'}
            blocked={
              editing ||
              query.isError ||
              start.isPending ||
              !!pending ||
              !query.data?.jobs.some((j) => j.id === job.id)
            }
            onChange={refresh}
            onRetry={beginReview}
            retryBlocked={
              blocked || (pending || localEdit || start.isPending ? '请先完成当前操作。' : '')
            }
          />
        )}
      </details>
      <details className="chapter-review-history" open={!job || !!pending || start.isError}>
        <summary>复审批次与重新检查</summary>
        <section
          hidden={phase === 'done' || (!!onPrepare && !!query.data && !query.data.current)}
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
              hidden={failed}
              onClick={beginReview}
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
            复审记录
            {job ? ` · ${job.input.enhancedContinuity ? '含加强衔接检查' : '常规检查'}` : ''}
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
      </details>
    </>
  );
}
function ReviewResult({
  job,
  blocked,
  onChange,
  onRead,
  continuation,
  finalized,
  onRetry,
  retryBlocked,
}: {
  onRetry: () => void;
  retryBlocked: string;
  finalized: boolean;
  job: ChapterReviewJob;
  blocked: boolean;
  onChange: () => void;
  onRead?: (view: ManuscriptInspection) => void;
  continuation?: { label: string; onClick: () => void };
}) {
  const failed = job.status === 'failed' || job.status === 'interrupted';
  const [view, setView] = useState<'findings' | 'decision'>('findings');
  const tabsRef = useRef<HTMLDivElement>(null);
  const switchView = (next: 'findings' | 'decision') => {
    setView(next);
    tabsRef.current?.scrollIntoView({ block: 'nearest' });
  };
  const [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState('');
  const [pending, setPending] = useState<ChapterReviewDecision | null>(null),
    [stale, setStale] = useState(false);
  const [selectedSource, setSelectedSource] = useState('');
  const [keptFindings, setKeptFindings] = useState<string[]>([]);
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
  const hasDecision = job.status === 'completed' && !existing;
  const findingCount = job.output?.critics.reduce((n, c) => n + c.findings.length, 0) ?? 0;
  useWritingPending(Boolean(pending || (!existing && (reason.trim() || keptFindings.length))));
  const decisionBlock = !current
    ? t.sourceChanged
    : job.status !== 'completed'
      ? job.status === 'running'
        ? t.busy
        : '整章复审尚未完成，请先重试。'
      : existing
        ? t.notFinal
        : !reason.trim()
          ? t.reasonRequired
          : confirmed !== confirmationKey
            ? t.confirmRequired
            : '';
  const judgementKeys =
    job.output?.critics.flatMap((c) =>
      c.findings
        .filter((f) => f.severity === 'P3' && (f.requiresHuman || f.possibleDialogueLie))
        .map((f) => `${c.critic}/${f.id}`),
    ) ?? [];
  const approvalBlock =
    job.canApproveAfterJudgement && judgementKeys.every((key) => keptFindings.includes(key))
      ? ''
      : job.approvalBlock;
  const send = (action: ChapterReviewDecision['action']) => {
    const req = {
      requestId: crypto.randomUUID(),
      assemblyVersion: job.input.draftVersion,
      inputDigest: job.inputDigest,
      action,
      reason: reason.trim(),
      keptFindings,
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
    <div className="page-stack chapter-review-workbench">
      <div className="writing-next-step">
        <strong>
          章稿 v{job.input.draftVersion} ·{' '}
          {!job.current
            ? '来源已更新，需重新复审'
            : finalized
              ? '已定稿'
              : existing?.action === 'approve'
                ? '复审已通过'
                : t[job.status]}
        </strong>
        <p>
          {!job.current
            ? '下一步：用最新采用稿更新组稿，再复审整章；已采用段落无需重复采用。'
            : finalized
              ? '正文、审核与章末事实已保存，可以继续下一章。'
              : existing?.action === 'approve'
                ? '下一步：整理章末事实，确认后定稿。'
                : existing
                  ? '下一步：回到正文修改，再保存章稿并复审。'
                  : job.status === 'running'
                    ? '正在审读整章，完成后等待你的判断。'
                    : failed
                      ? '段落采用已完成。当前停在整章复审，尚未进入作者确认与定稿；无需重新采用各段。'
                      : '通读正文与审查意见，然后决定通过或退回修改。'}
        </p>
      </div>
      {job.provider === 'fake' && <p>{t.fake}</p>}
      {failed && !existing && (
        <section className="writing-next-step" aria-label="复审失败原因">
          <strong>{job.failure?.stage ?? '复审执行'}未完成</strong>
          <p role="alert">
            {job.failure?.message ??
              readableMessage(job.message, '失败记录未提供可定位的原因，请重试整章复审。')}
          </p>
          <p>已采用正文保留。重试会读取同一章稿重新检查，不会生成或替换正文。</p>
          <Button
            disabled={!!retryBlocked || !job.current}
            disabledReason={retryBlocked || t.sourceChanged}
            onClick={onRetry}
          >
            重试整章复审
          </Button>
        </section>
      )}
      {!existing && !failed && job.status === 'running' && (
        <p role="status">{readableMessage(job.message, '正在审读整章…')}</p>
      )}
      {existing?.action === 'approve' && (
        <ChapterPublication
          continuation={continuation}
          job={{ ...job, decision: existing }}
          blocked={blocked || stale || !!pending || save.isPending}
        />
      )}
      <details className="chapter-review-archive" open={existing?.action !== 'approve'}>
        <summary hidden={existing?.action !== 'approve'}>已完成的复审 · 意见与作者决定</summary>
        <div className="page-stack">
          {hasDecision && (
            <div
              className="chapter-review-tabs"
              role="tablist"
              aria-label="整章复审工作区"
              ref={tabsRef}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'findings'
                    : event.key === 'End'
                      ? 'decision'
                      : view === 'findings'
                        ? 'decision'
                        : 'findings';
                switchView(next);
                tabsRef.current
                  ?.querySelector<HTMLButtonElement>(`#review-${next}-tab-${job.id}`)
                  ?.focus();
              }}
            >
              <button
                role="tab"
                tabIndex={view === 'findings' ? 0 : -1}
                aria-selected={view === 'findings'}
                aria-controls={`review-findings-${job.id}`}
                id={`review-findings-tab-${job.id}`}
                onClick={() => switchView('findings')}
              >
                审查意见 · {findingCount}
              </button>
              <button
                role="tab"
                tabIndex={view === 'decision' ? 0 : -1}
                aria-selected={view === 'decision'}
                aria-controls={`review-decision-${job.id}`}
                id={`review-decision-tab-${job.id}`}
                onClick={() => switchView('decision')}
              >
                作者决定
              </button>
            </div>
          )}
          <section
            className="chapter-review-findings"
            role={hasDecision ? 'tabpanel' : undefined}
            id={`review-findings-${job.id}`}
            aria-labelledby={hasDecision ? `review-findings-tab-${job.id}` : undefined}
            hidden={hasDecision && view !== 'findings'}
          >
            {onRead && (
              <div className="chapter-review-reading">
                <Button size="sm" onClick={() => inspect()}>
                  对照审核原文（只读）
                </Button>
                <p className="muted">
                  在中间正文区打开本次审核的章稿 v{job.input.draftVersion}
                  ，可定位意见；返回写作后再修改。
                </p>
              </div>
            )}
            {failed && <p>审查未完成 · 已返回的结果</p>}
            <div className="chapter-review-groups">
              {job.output?.critics.map((c) => (
                <details className="chapter-review-group" key={c.critic}>
                  <summary>
                    {c.critic === 'hard_consistency' ? t.hard_consistency : t.ai_taste} ·{' '}
                    {c.status === 'failed' ? '未完成' : `${c.findings.length} 个问题（已完成）`}
                  </summary>
                  <div className="chapter-review-group-body">
                    {c.status === 'failed' ? (
                      <p role="alert">
                        {c.failure?.message ??
                          readableMessage(c.error, '本路审查未完成，不能按零问题处理。')}
                      </p>
                    ) : !c.findings.length ? (
                      <p>{t.emptyFindings}</p>
                    ) : null}
                    {c.findings.map((f) => (
                      <details className="chapter-review-finding" key={f.id}>
                        <summary>
                          <Badge>{f.severity}</Badge>{' '}
                          <span>
                            {job.input.parts.find((p) =>
                              p.segments.some((source) => source.id === f.segmentId),
                            )?.title ?? '当前章稿'}
                          </span>
                          <span className="chapter-review-quote">{f.quote}</span>
                        </summary>
                        <div className="chapter-review-finding-body">
                          {f.requiresHuman && <span>{t.human}</span>}
                          <blockquote>{f.quote}</blockquote>
                          <p>{f.reason}</p>
                          <p>
                            {t.suggestion}：{f.suggestion}
                          </p>
                          <p>
                            {t.scope}：
                            {repairScopeLabels[f.repairScope] ?? '请结合意见确认修改范围'}
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
                          {f.severity === 'P3' && (f.requiresHuman || f.possibleDialogueLie) && (
                            <label className="outline-check">
                              <input
                                type="checkbox"
                                disabled={!current || !!pending || !!existing}
                                checked={(existing?.keptFindings ?? keptFindings).includes(
                                  `${c.critic}/${f.id}`,
                                )}
                                onChange={(e) =>
                                  setKeptFindings((items) =>
                                    e.target.checked
                                      ? [...items, `${c.critic}/${f.id}`]
                                      : items.filter((key) => key !== `${c.critic}/${f.id}`),
                                  )
                                }
                              />
                              保留这处原文（作者已判断）
                            </label>
                          )}
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
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
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
          </section>
          {existing ? (
            <details>
              <summary>{existing.action === 'approve' ? t.approved : t.requested}</summary>
              <p role="status">
                {existing.reason}
                {!job.current ? ` · ${t.sourceChanged}` : ''}
              </p>
            </details>
          ) : !failed ? (
            <section
              className="chapter-review-decision"
              role={hasDecision ? 'tabpanel' : undefined}
              id={`review-decision-${job.id}`}
              aria-labelledby={hasDecision ? `review-decision-tab-${job.id}` : undefined}
              hidden={
                (hasDecision && view !== 'decision') ||
                (!!onRead && !job.current && !pending && !reason) ||
                job.status !== 'completed'
              }
            >
              <p className="muted">
                通过后核对章末事实并定稿；返工要求只做记录，由你选择需要修改的段落。
              </p>
              <label>
                {t.reason}
                <textarea
                  value={reason}
                  rows={3}
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
              {approvalBlock && <p>{approvalBlock}</p>}
              <div className="core-heading">
                <Button
                  variant="default"
                  disabled={!!decisionBlock || !!approvalBlock || !!pending}
                  disabledReason={decisionBlock || approvalBlock || t.uncertainSave}
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
            </section>
          ) : null}
          <details className="chapter-review-reference">
            <summary>参考与技术记录</summary>
            <div className="chapter-review-reference-body">
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
            </div>
          </details>
        </div>
      </details>
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
