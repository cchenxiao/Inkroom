import { TextChange } from './text-change';
import { repairScopeLabels } from '@/shared/lib/business-labels';
import { TechnicalDetails } from '@/shared/ui/technical-details';
import { sourceLabel } from '@/features/prepare/writing';
import { useState } from 'react';
import { WritingMemory } from './writing-memory';
import { WritingLedger } from './writing-ledger';
import { Link } from 'react-router-dom';
import { Badge, Button } from '@/shared/ui';
import { QualityGateCard } from '@/shared/ui/quality-gate-card';
import { livePreparePath } from '@/shared/lib/writing-mode';
import { writingDesk as t } from '@/shared/lib/messages-writing-desk';
import type { PlanningState, BackendRun } from '@/features/prepare/writing';
export function WritingBible({
  planning,
  chapterId,
  runId,
  beatId = '',
}: {
  planning: PlanningState;
  chapterId: string;
  runId?: string;
  beatId?: string;
}) {
  const [tab, setTab] = useState('人物');
  const core = planning.coreSelection;
  const characters =
    core?.content.characters.filter((c) => core.decisions[c.id] === 'confirmed') ?? [];
  const facts = core?.content.worldFacts.filter((f) => core.decisions[f.id] === 'confirmed') ?? [];
  const plans = core?.content.plans.filter((p) => core.decisions[p.id] === 'confirmed') ?? [];
  const style = planning.styleSelection;
  return (
    <div className="writing-bible">
      <div className="writing-panel-tabs" role="tablist" aria-label={t.knowledge}>
        {['前情', '人物', '时间线', '伏笔', '规则', '信息差', '风格'].map((label) => (
          <button
            role="tab"
            aria-selected={tab === label}
            key={label}
            onClick={() => setTab(label)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === '前情' && <WritingMemory key={`${runId}/${beatId}`} runId={runId} beatId={beatId} />}
      {tab === '人物' &&
        characters.map((c) => (
          <details key={c.id} open={c === characters[0]}>
            <summary>
              {c.name} <small>{c.role}</small>
            </summary>
            <dl>
              <dt>想要</dt>
              <dd>{c.want}</dd>
              <dt>需要</dt>
              <dd>{c.need}</dd>
              <dt>缺陷</dt>
              <dd>{c.flaw}</dd>
              <dt>成长方向</dt>
              <dd>{c.arcIntent}</dd>
              <dt>{t.voices}</dt>
              <dd>{c.voice.join('；')}</dd>
            </dl>
            {facts
              .filter((f) => c.hardFactIds.includes(f.id))
              .map((f) => (
                <p key={f.id}>{f.text}</p>
              ))}
          </details>
        ))}
      {tab === '时间线' && (
        <WritingLedger
          mode="timeline"
          chapterNumber={
            (planning.outlineSelection?.content.chapters.findIndex((c) => c.id === chapterId) ??
              -1) + 1
          }
        />
      )}
      {tab === '伏笔' && (
        <>
          <p className="muted">{t.uncertainFacts}。正式埋设与回收台账尚未接入。</p>
          {plans.map((p) => (
            <article key={p.id}>{p.intent}</article>
          ))}
        </>
      )}
      {tab === '规则' &&
        facts.map((f) => (
          <article key={f.id}>
            <Badge>{f.rigidity === 'hard' ? '硬约束' : '软设定'}</Badge>
            <p>{f.text}</p>
          </article>
        ))}
      {tab === '信息差' && (
        <WritingLedger
          mode="knowledge"
          chapterNumber={
            (planning.outlineSelection?.content.chapters.findIndex((c) => c.id === chapterId) ??
              -1) + 1
          }
        />
      )}
      {tab === '风格' && style && (
        <>
          <p>
            {style.rules.pov} · {style.rules.tense}
          </p>
          <p>{style.rules.tone}</p>
          <p>{style.rules.styleArc}</p>
          <p>
            句长目标 {style.rules.sentenceLength.min}–{style.rules.sentenceLength.max} 字 · 对话目标{' '}
            {style.rules.dialogueRatio.min * 100}–{style.rules.dialogueRatio.max * 100}%（软目标）
          </p>
          <p>禁用表达：{style.rules.bannedPhrases.join('、')}</p>
          <details>
            <summary>{t.anchor}</summary>
            <blockquote>{style.anchorText}</blockquote>
          </details>
        </>
      )}
      {!core && <p>{t.noData}</p>}
      <Link
        className="writing-edit-link"
        to={livePreparePath(tab === '风格' ? 'style' : 'world', chapterId)}
      >
        编辑并复核设定 →
      </Link>
    </div>
  );
}
export function WritingGate({ run, stale }: { run?: BackendRun; stale: boolean }) {
  const findings = run?.result?.report.findings ?? [];
  const blockers = [
    ...new Set(
      [
        stale ? t.stale : '',
        run?.approvalBlock ?? '',
        !run ? '尚未生成本段正文' : '',
        run?.status === 'running' ? '审查尚未完成' : '',
      ].filter(Boolean),
    ),
  ];
  return (
    <QualityGateCard
      scores={{
        items: [],
        p0Count: findings.filter((f) => f.severity === 'P0').length,
        canFinalize: run?.status === 'approved' && !blockers.length,
        blockers,
      }}
      blockers={blockers}
    />
  );
}
export function findingDecision(run: BackendRun | undefined, id: string) {
  return run?.result?.findingDecisions
    ?.filter((d) => d.findingId === id && d.draftVersion === run.draftVersion)
    .at(-1);
}

export function WritingFinding({
  run,
  id,
  onClose,
  onEdit,
  onInstruct,
  onDecision,
  onApply,
  onDiscard,
  editBlock = '',
  rewriteBlock = '',
  decisionBlock = '',
  busy = false,
  initialEdit = false,
  onRecover,
  recoveryBlock = '',
  onPendingInstruction,
}: {
  run?: BackendRun;
  id: string;
  onClose: () => void;
  onEdit: (replacement: string) => Promise<boolean | undefined>;
  onInstruct: (instruction: string, wholeSegment: boolean) => Promise<boolean | undefined>;
  onDecision: (decision: 'keep' | 'reopen', reason: string) => Promise<boolean | undefined>;
  onApply?: (proposalId: string) => Promise<boolean | undefined>;
  onDiscard?: (proposalId: string) => Promise<boolean | undefined>;
  editBlock?: string;
  rewriteBlock?: string;
  decisionBlock?: string;
  busy?: boolean;
  initialEdit?: boolean;
  onRecover?: () => void;
  recoveryBlock?: string;
  onPendingInstruction?: () => void;
}) {
  const f = run?.result?.report.findings.find((f) => f.id === id);
  const [mode, setMode] = useState<'edit' | 'rewrite' | null>(initialEdit ? 'edit' : null);
  const [value, setValue] = useState(initialEdit ? (f?.quote ?? '') : '');
  const [whole, setWhole] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const decision = findingDecision(run, id);
  const local = !!f && ['P2', 'P3'].includes(f.severity) && id !== 'author-request-review';
  const proposal =
    run?.result?.findingProposal?.findingId === id ? run.result.findingProposal : undefined;
  const changed = run?.result?.findingChanges?.find((c) => c.findingId === id);
  const proposalBusy = !!run?.result?.findingProposal;
  const kept = decision?.decision === 'keep';
  if (!f) return null;
  const open = (next: typeof mode) => {
    setMode(next);
    setValue(next === 'edit' ? f.quote : next === 'rewrite' ? f.suggestion : '');
    setWhole(false);
    setNotice('');
  };
  const submit = async (decision?: 'keep' | 'reopen') => {
    if (sending || busy || (decision && (decisionBlock || proposalBusy))) return;
    setSending(true);
    setNotice('');
    try {
      const ok = decision
        ? await onDecision(decision, '')
        : mode === 'edit'
          ? await onEdit(value)
          : await onInstruct(value, whole);
      if (ok) {
        setMode(null);
        setNotice(
          decision
            ? decision === 'keep'
              ? '已保留原文。'
              : '已撤销保留，恢复待处理。'
            : local
              ? mode === 'rewrite'
                ? ''
                : '已提交局部修改，处理完其他问题后请统一复审。'
              : '已提交，正在复检；完成后请核对新稿。',
        );
      } else setNotice('操作未提交，请核对当前稿状态；输入已保留，可以重试。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提交失败，输入已保留，请重试。');
    } finally {
      setSending(false);
    }
  };
  const confirmPreview = async (apply: boolean) => {
    if (!proposal || busy || sending) return;
    setSending(true);
    try {
      const ok = await (apply ? onApply?.(proposal.id) : onDiscard?.(proposal.id));
      setNotice(
        ok
          ? apply
            ? '已提交确认，保存后可继续处理其他问题。'
            : '已提交放弃预览，正文不变。'
          : '操作未完成，预览已保留，请检查状态后重试。',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提交失败，预览已保留。');
    } finally {
      setSending(false);
    }
  };
  const unavailable =
    mode === 'edit' ? editBlock : mode === 'rewrite' ? rewriteBlock : decisionBlock;
  return (
    <aside className="finding-popover" aria-label="问题详情">
      <header>
        <Badge tone={f.severity === 'P0' ? 'danger' : 'muted'}>{f.severity}</Badge>
        <strong>{f.critic === 'hard_consistency' ? '一致性审查' : 'AI 味审查'}</strong>
        {kept && <Badge tone="human">作者保留原文</Badge>}
        <Button size="sm" variant="ghost" disabled={sending} onClick={onClose}>
          关闭
        </Button>
      </header>
      <blockquote>{f.quote}</blockquote>
      <p>{f.reason}</p>
      <p>{f.suggestion}</p>
      {f.evidenceRefs.some(
        (ref) => ref !== f.segmentId && run?.result?.segments?.some((s) => s.id === ref),
      ) && (
        <p className="muted">
          这条意见涉及其他段落。本次只修改上方引用所属的情节段；其他段落作为核对依据。如需两边一起调整，请分别选择要改的正文。
        </p>
      )}
      <details>
        <summary>证据与修复范围</summary>
        {f.evidenceRefs.map((ref) => (
          <p key={ref}>
            {run ? sourceLabel(run, ref, '关联证据（原文暂缺）') : '关联证据（原文暂缺）'}
          </p>
        ))}
        <p>{repairScopeLabels[f.repairScope] ?? '请结合意见确认修改范围'}</p>
        <TechnicalDetails items={{ 证据编号: f.evidenceRefs.join('、'), 问题编号: f.id }} />
      </details>
      {kept && decision.reason && <p className="finding-decision">保留理由：{decision.reason}</p>}
      {changed && (
        <section aria-label="已保存修改对照">
          <p role="status" className="finding-decision">
            本条已修改，待统一复审；尚未判定问题已解决。
          </p>
          <TextChange before={changed.before} after={changed.after} />
        </section>
      )}
      {proposal && (
        <section className="finding-preview" aria-label="局部修改对照">
          <strong>修改预览 · 正文尚未改变</strong>
          <TextChange
            before={Array.from(proposal.request.original)
              .slice(proposal.request.start, proposal.request.end)
              .join('')}
            after={proposal.replacement}
          />
          <p className="muted">
            范围与边界已校验；请核对表达。确认后仅保存这处修改，暂不重新审核整段。
          </p>
          <div className="page-actions">
            <Button
              size="sm"
              variant="default"
              loading={sending}
              disabled={busy}
              onClick={() => void confirmPreview(true)}
            >
              确认替换这处
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || sending}
              onClick={() => void confirmPreview(false)}
            >
              放弃这次预览
            </Button>
          </div>
        </section>
      )}
      {!proposal && !changed && (
        <div className="page-actions finding-action-choices" aria-label="处理这条问题">
          <Button
            size="sm"
            disabled={busy || sending || proposalBusy}
            aria-pressed={mode === 'edit'}
            onClick={() => open('edit')}
          >
            我来修改
          </Button>
          <Button
            size="sm"
            disabled={busy || sending || proposalBusy}
            aria-pressed={mode === 'rewrite'}
            onClick={() => open('rewrite')}
          >
            让模型修改
          </Button>
          {kept ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || sending || proposalBusy || !!decisionBlock}
              disabledReason={decisionBlock}
              onClick={() => void submit('reopen')}
            >
              撤销保留
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || sending || proposalBusy || !!decisionBlock}
              disabledReason={decisionBlock}
              onClick={() => void submit('keep')}
            >
              保留原文
            </Button>
          )}
        </div>
      )}
      {mode && !proposal && !changed && (
        <form
          className="finding-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <strong>{mode === 'edit' ? '修改引用原文' : '针对这条问题修改'}</strong>
          {mode === 'rewrite' && !local && (
            <label>
              修改范围
              <select
                aria-label="修改范围"
                value={whole ? 'segment' : 'quote'}
                disabled={sending || busy}
                onChange={(event) => setWhole(event.target.value === 'segment')}
              >
                <option value="quote">仅引用原文</option>
                <option value="segment">当前情节段</option>
              </select>
            </label>
          )}
          <p className="muted">
            {mode === 'edit'
              ? local
                ? '只保存这处修改，保留其他问题，处理完后统一复审。'
                : '只替换上方引用的文字；保存后重新检查，不自动采用。'
              : local
                ? run?.commitId || run?.status === 'committed' || run?.status === 'approved'
                  ? '基于当前稿生成这句话的修改预览；原采用稿保留，确认替换后再复审新候选。'
                  : '仅生成这条问题的修改预览；你确认后才替换正文，不自动重新审核整段。'
                : '将携带这条问题、原文和你的要求；不会自动修改其他情节段。'}
          </p>
          {unavailable ? (
            <div className="finding-recovery" role="status">
              <p>{unavailable}</p>
              {onPendingInstruction ? (
                <Button type="button" size="sm" onClick={onPendingInstruction}>
                  处理未发送的修改要求
                </Button>
              ) : onRecover ? (
                <>
                  <p className="muted">保留正文，按最新上下文更新审核；完成后继续处理这处问题。</p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!!recoveryBlock || busy}
                    disabledReason={recoveryBlock}
                    onClick={onRecover}
                  >
                    更新审核后继续修改
                  </Button>
                  {recoveryBlock && <p>{recoveryBlock}</p>}
                </>
              ) : null}
            </div>
          ) : (
            <>
              <label>
                {mode === 'edit' ? '替换为' : '修改要求'}
                <textarea
                  autoFocus
                  rows={4}
                  value={value}
                  disabled={busy || sending || proposalBusy}
                  maxLength={mode === 'edit' ? 20000 : 1000}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
              <div className="page-actions">
                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  loading={sending}
                  disabled={busy || (mode === 'edit' ? value === f.quote : !value.trim())}
                >
                  {mode === 'edit'
                    ? local
                      ? '保存这处修改'
                      : '保存修改并复检'
                    : local
                      ? '生成修改预览'
                      : '发送给模型'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={sending}
                  onClick={() => setMode(null)}
                >
                  取消
                </Button>
              </div>
            </>
          )}
        </form>
      )}
      {run?.status === 'failed' ? (
        <p role="alert">本次操作已停止，请从运行提示查看原因并恢复；此前保存的正文保留。</p>
      ) : (
        notice && <p role="status">{notice}</p>
      )}
    </aside>
  );
}
