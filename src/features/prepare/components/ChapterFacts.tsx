import { TechnicalDetails } from '@/shared/ui/technical-details';
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
import { usePlanning } from '../hooks/usePlanning';
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
      previous.current = j;
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
    if (latest && state?.selection && !confirmed) {
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
      {start.isError && (
        <p role="alert">{start.error instanceof ApiError ? start.error.message : t.unknown}</p>
      )}
      {start.isPending && <p role="status">正在启动事实整理，已保存的正文保持不变…</p>}
      {pending && !start.isPending && (
        <Button onClick={() => start.mutate(pending)}>{t.retry}</Button>
      )}
      {job && (
        <>
          <p role={job.status === 'failed' || job.status === 'interrupted' ? 'alert' : 'status'}>
            {job.status === 'running'
              ? t.busy
              : job.status === 'completed' && job.output
                ? `已整理 ${job.output.candidates.length} 条候选，请核对后选择处理方式。`
                : readableMessage(job.failure?.message ?? job.message, '请核对本次事实整理结果。')}
          </p>
          {(job.status === 'failed' || job.status === 'interrupted') && (
            <p>
              {job.failure
                ? '本批次未生成可确认的候选。可选择“我来整理事实”，按原文补充并保存逐条决定；完成核对后再定稿。'
                : '这条历史记录未保存具体失败原因。可重新提取以记录诊断，或选择“我来整理事实”继续核对。'}
            </p>
          )}
          {job.provider === 'human' && <p>{t.noModel}</p>}
          {job.provider === 'fake' && <p>{t.fake}</p>}
          {latest?.id !== job.id && job.id !== start.data?.id && (
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
            <p>
              {job.provider === 'human' ? '人工整理' : '模型整理'} · {job.calls.length} 次模型调用
            </p>
            {job.calls.map((c) => (
              <p key={c.number}>
                第 {c.number} 次 ·{' '}
                {c.phase === 'finished'
                  ? c.success === true
                    ? '调用已完成（不代表候选校验通过）'
                    : c.success === false
                      ? '调用未成功'
                      : '调用已结束，结果未标记'
                  : c.phase === 'started'
                    ? '调用中'
                    : '调用结果未确认'}
                {c.elapsedMs != null ? ` · ${(c.elapsedMs / 1000).toFixed(1)} 秒` : ''}
              </p>
            ))}
            <TechnicalDetails
              items={{
                整理记录编号: job.id,
                失败阶段: job.failure?.stage,
                错误码: job.failure?.code,
              }}
            />
          </details>
        </>
      )}
      <details
        open={!job || job.status === 'failed' || job.status === 'interrupted'}
        className="chapter-facts-restart"
      >
        <summary hidden={!job}>重新整理候选</summary>
        <h4>{t.title}</h4>
        <p className="muted">{t.note}</p>
        <div className="core-heading">
          <Button disabled={disabled} disabledReason={t.editBlock} onClick={() => begin('model')}>
            {t.model}
          </Button>
          <Button
            variant={
              job?.status === 'failed' || job?.status === 'interrupted' ? 'default' : 'secondary'
            }
            disabled={disabled}
            disabledReason={t.editBlock}
            onClick={() => begin('manual')}
          >
            {t.manual}
          </Button>
        </div>
      </details>
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
  const planning = usePlanning();
  const characterNames = new Map(
    planning.data?.coreSelection?.content.characters.map((c) => [c.id, c.name]) ?? [],
  );
  const [editingDecision, setEditingDecision] = useState('');
  const [correction, setCorrection] = useState<{
    id: string;
    text: string;
    basis: NonNullable<FactDecision['eventBasis']>;
  } | null>(null);
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
  const otherPending = useWritingPending(Boolean(dirty || correction || pending || save.isPending));
  // Polls never replace unsaved author decisions; their original base version stays frozen.
  useEffect(() => {
    if (!dirty && !correction && !pending && (selection?.version ?? 0) >= baseVersion) {
      setDecisions(selection?.request.decisions ?? []);
      setManual(selection?.request.manual ?? []);
      setBaseVersion(selection?.version ?? 0);
    }
  }, [selection, dirty, correction, pending, baseVersion]);
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
  const decisionReasons: Record<FactDecision['action'], string> = {
    confirm: '作者选择确认为新增事实',
    exclude: '作者选择不写入章末事实',
    keep_existing: '作者选择保留已有事实',
    revise_manuscript: '作者要求先修改正文',
  };
  const choose = (id: string, action: FactDecision['action']) => {
    setEditingDecision('');
    const previous = decisions.find((d) => d.candidateId === id);
    change(id, {
      action,
      ...(!previous && action === 'confirm'
        ? {
            knownBy: (candidates.find((c) => c.id === id)?.suggestedKnowers ?? []).map(
              (k) => k.characterId,
            ),
          }
        : {}),
      reason:
        previous?.reason && !Object.values(decisionReasons).includes(previous.reason)
          ? previous.reason
          : decisionReasons[action],
    });
  };
  const undecided = candidates.filter((c) => !decisions.some((d) => d.candidateId === c.id));
  const ordinary = undecided.filter(
    (c) => c.kind === 'event' && !c.relatedFactId && !manual.some((m) => m.id === c.id),
  );
  const decideBatch = (items: FactCandidate[], action: 'confirm' | 'exclude') => {
    if (locked || !items.length) return;
    setDirty(true);
    setDecisions((old) => [
      ...old,
      ...items
        .filter((c) => !old.some((d) => d.candidateId === c.id))
        .map((c) => ({
          candidateId: c.id,
          action,
          text: c.text,
          knownBy: action === 'confirm' ? (c.suggestedKnowers ?? []).map((k) => k.characterId) : [],
          reason: decisionReasons[action],
        })),
    ]);
  };
  const editManual = (id: string, patch: Partial<FactCandidate>) => {
    setDirty(true);
    setManual((old) => old.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setDecisions((old) => old.filter((d) => d.candidateId !== id));
  };
  return (
    <div className="page-stack">
      <div className="chapter-facts-actions">
        <Button
          disabled={
            locked ||
            (!!selection && !dirty) ||
            !!correction ||
            stale ||
            baseVersion !== (selection?.version ?? 0) ||
            decisions.some((d) => !d.reason.trim())
          }
          disabledReason={selection && !dirty ? '事实决定已保存，没有未保存修改' : t.editBlock}
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
          disabled={!dirty || !!pending || save.isPending}
          onClick={() => {
            setDirty(false);
            setCorrection(null);
            setEditingDecision('');
            setStale(false);
            setDecisions(selection?.request.decisions ?? []);
            setManual(selection?.request.manual ?? []);
            setBaseVersion(selection?.version ?? 0);
          }}
        >
          {t.cancel}
        </Button>
        {!dirty && selection && <span role="status">事实决定已保存</span>}
      </div>
      {!!candidates.length && (
        <section className="chapter-facts-batch" aria-label="批量处理事实">
          <strong>
            已处理 {candidates.length - undecided.length}/{candidates.length} 条
            {dirty ? ' · 未保存' : ''}
          </strong>
          <p className="muted">仅处理尚未决定的条目，不覆盖已有决定。普通决定无需另填理由。</p>
          <div className="chapter-fact-choices">
            {ordinary.length > 0 ? (
              <Button
                size="sm"
                disabled={locked || !!correction}
                onClick={() => decideBatch(ordinary, 'confirm')}
              >
                将 {ordinary.length} 条普通事件计入
              </Button>
            ) : (
              <span className="muted">没有待批量计入的普通事件</span>
            )}
            <Button
              size="sm"
              disabled={locked || !!correction || !undecided.length}
              onClick={() => decideBatch(undecided, 'exclude')}
            >
              排除其余 {undecided.length} 条
            </Button>
          </div>
        </section>
      )}
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
          <article key={c.id} className="chapter-fact-card" aria-label={`事实 ${i + 1}`}>
            <div className="chapter-fact-overview">
              <div>
                <Badge>
                  {t.candidate} {i + 1}
                </Badge>{' '}
                ·{' '}
                {d
                  ? {
                      confirm: '已选计入',
                      exclude: '已选不计入',
                      keep_existing: '保留已有事实',
                      revise_manuscript: '需修改正文',
                    }[d.action]
                  : t.pending}
              </div>
              <p>{d?.action === 'confirm' ? d.text : c.text || '请填写新增事实'}</p>
              {(c.kind !== 'event' || c.relatedFactId) && !d?.eventBasis && (
                <p className="muted">
                  {c.relatedFactId
                    ? '涉及已有事实，需单独判断'
                    : '模型分类：' + t[c.kind] + '。可由作者调整分类。'}
                </p>
              )}
              {d?.eventBasis && (
                <p className="muted">
                  作者修正：
                  {d.eventBasis === 'speech_act'
                    ? '记录说话 / 回忆这一行为，不判定话中内容为真'
                    : '已核对为实际发生的事件'}
                </p>
              )}
              {d && editingDecision !== c.id ? (
                <Button
                  size="sm"
                  disabled={locked || !!correction}
                  onClick={() => setEditingDecision(c.id)}
                >
                  更改决定
                </Button>
              ) : (
                <div className="chapter-fact-choices">
                  {(c.kind === 'event' || d?.eventBasis) && !c.relatedFactId && (
                    <Button
                      size="sm"
                      disabled={locked}
                      aria-pressed={d?.action === 'confirm'}
                      onClick={() => choose(c.id, 'confirm')}
                    >
                      计入事实
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={locked}
                    aria-pressed={d?.action === 'exclude'}
                    onClick={() => choose(c.id, 'exclude')}
                  >
                    不记入事实
                  </Button>
                  {c.relatedFactId && (
                    <Button
                      size="sm"
                      disabled={locked}
                      aria-pressed={d?.action === 'keep_existing'}
                      onClick={() => choose(c.id, 'keep_existing')}
                    >
                      保留已有事实
                    </Button>
                  )}
                  {c.kind !== 'event' && !c.relatedFactId && (
                    <Button
                      size="sm"
                      disabled={locked || !!correction}
                      onClick={() =>
                        setCorrection({
                          id: c.id,
                          text: d?.text || c.text,
                          basis:
                            d?.eventBasis ||
                            (c.kind === 'statement' ? 'speech_act' : 'observed_event'),
                        })
                      }
                    >
                      调整分类并计入
                    </Button>
                  )}
                  {d && (
                    <Button
                      size="sm"
                      disabled={locked}
                      onClick={() => {
                        setDirty(true);
                        setDecisions((old) => old.filter((item) => item.candidateId !== c.id));
                      }}
                    >
                      撤销决定
                    </Button>
                  )}
                </div>
              )}
              {correction?.id === c.id && (
                <section className="chapter-fact-correction" aria-label="作者修正分类">
                  <strong>按原文修正模型分类</strong>
                  <blockquote>{c.evidence.quote}</blockquote>
                  <label>
                    记录方式
                    <select
                      disabled={locked}
                      value={correction.basis}
                      onChange={(e) =>
                        setCorrection({
                          ...correction,
                          basis: e.target.value as NonNullable<FactDecision['eventBasis']>,
                        })
                      }
                    >
                      <option value="speech_act">记录说话 / 回忆这一行为</option>
                      <option value="observed_event">作者核对为已发生事件</option>
                    </select>
                  </label>
                  <p className="muted">
                    {correction.basis === 'speech_act'
                      ? '请写成“某人说 / 回忆了什么”，不要把话中内容直接写成客观事实。'
                      : '请按原文记录已经发生的事件，保留计划、推测与事实的区别。'}
                  </p>
                  <label>
                    修正后的事实
                    <textarea
                      rows={3}
                      maxLength={500}
                      readOnly={locked}
                      value={correction.text}
                      onChange={(e) => setCorrection({ ...correction, text: e.target.value })}
                    />
                  </label>
                  <div className="chapter-fact-choices">
                    <Button
                      disabled={locked || !correction.text.trim()}
                      onClick={() => {
                        change(c.id, {
                          action: 'confirm',
                          eventBasis: correction.basis,
                          text: correction.text.trim(),
                          reason:
                            correction.basis === 'speech_act'
                              ? '作者将模型分类修正为言语或回忆事件'
                              : '作者核对原文后修正为已发生事件',
                        });
                        setCorrection(null);
                        setEditingDecision('');
                      }}
                    >
                      应用修正并计入
                    </Button>
                    <Button onClick={() => setCorrection(null)}>取消调整</Button>
                  </div>
                </section>
              )}
              {d?.action === 'confirm' && (
                <fieldset disabled={locked} className="chapter-fact-knowers">
                  <legend>角色知情范围（可选）</legend>
                  {!!c.suggestedKnowers?.length && (
                    <details>
                      <summary>模型建议与原文依据 · {c.suggestedKnowers.length} 人</summary>
                      <p className="muted">
                        首次计入时预选有依据的建议；可取消或补选，保存事实决定后才生效。
                      </p>
                      {c.suggestedKnowers.map((k) => (
                        <blockquote key={k.characterId}>
                          <strong>
                            {characterNames.get(k.characterId) ??
                              job.input.characterNames?.[k.characterId] ??
                              k.characterId}
                          </strong>
                          ：{k.evidence.quote}
                        </blockquote>
                      ))}
                    </details>
                  )}
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
                      {characterNames.get(id) ?? id}
                    </label>
                  ))}
                  <p className="muted">
                    用于后续人物视角写作。不勾选仍会计入事实，但不会视为任何角色已知。
                  </p>
                </fieldset>
              )}
            </div>
            <details open={isManual}>
              <summary>证据与调整</summary>
              <div
                className="page-stack chapter-fact-body"
                role="region"
                aria-label={`事实候选 ${i + 1}`}
              >
                <p className="muted">{t[c.kind]}</p>
                {isManual ? (
                  <>
                    <label>
                      {t.source}
                      <select
                        disabled={locked}
                        value={c.evidence.ref}
                        onChange={(e) => {
                          const s = sources.find((s) => s.id === e.target.value);
                          editManual(c.id, {
                            evidence: { ref: e.target.value, quote: s?.text ?? '' },
                          });
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
                    {d?.action !== 'confirm' && (
                      <label>
                        {t.text}
                        <textarea
                          readOnly={locked}
                          maxLength={500}
                          value={c.text}
                          onChange={(e) => editManual(c.id, { text: e.target.value })}
                        />
                      </label>
                    )}
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
                    <p className="muted">{c.reason}</p>
                  </>
                )}
                {existing && (
                  <>
                    <p>{t.conflict}</p>
                    <blockquote>{existing.text}</blockquote>
                    {c.kind === 'event' && !isManual && (
                      <Button
                        size="sm"
                        disabled={locked || manual.length >= 8 || !!d}
                        onClick={() => {
                          const id = `manual-${crypto.randomUUID()}`;
                          setDirty(true);
                          setManual((old) => [
                            ...old,
                            {
                              ...c,
                              id,
                              relatedFactId: '',
                              reason: '作者按独立事件补充，保留旧设定',
                            },
                          ]);
                          change(c.id, {
                            action: 'keep_existing',
                            reason: '保留旧设定；新增事件另行核对与确认',
                          });
                        }}
                      >
                        这是独立新事件，另行补充
                      </Button>
                    )}
                  </>
                )}
                {c.kind !== 'event' && <p>{t.statementNote}</p>}
                <label>
                  {t.candidate} {i + 1} · 处理方式
                  <select
                    disabled={locked}
                    value={d?.action ?? ''}
                    onChange={(e) => choose(c.id, e.target.value as FactDecision['action'])}
                  >
                    <option value="" disabled>
                      {t.pending}
                    </option>
                    <option
                      value="confirm"
                      disabled={(c.kind !== 'event' && !d?.eventBasis) || !!c.relatedFactId}
                    >
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
              </div>
            </details>
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
      {save.isError && (
        <p role="alert">{save.error instanceof ApiError ? save.error.message : t.unknown}</p>
      )}
      {pending && !save.isPending && (
        <Button onClick={() => save.mutate(pending)}>{t.retrySave}</Button>
      )}
    </div>
  );
}
