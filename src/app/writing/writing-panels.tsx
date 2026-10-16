import { repairScopeLabels } from '@/shared/lib/business-labels';
import { TechnicalDetails } from '@/shared/ui/technical-details';
import { sourceLabel } from '@/features/prepare/writing';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button } from '@/shared/ui';
import { QualityGateCard } from '@/shared/ui/quality-gate-card';
import { livePreparePath } from '@/shared/lib/writing-mode';
import { writingDesk as t } from '@/shared/lib/messages-writing-desk';
import type { PlanningState, BackendRun } from '@/features/prepare/writing';
export function WritingBible({
  planning,
  chapterId,
}: {
  planning: PlanningState;
  chapterId: string;
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
        {['人物', '时间线', '伏笔', '规则', '信息差', '风格'].map((label) => (
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
      {tab === '时间线' &&
        facts.map((f) => (
          <article key={f.id}>
            <small>故事时间 {f.storyTime ?? '未知'}</small>
            <p>{f.text}</p>
          </article>
        ))}
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
      {tab === '信息差' &&
        facts.map((f) => (
          <article key={f.id}>
            <p>{f.text}</p>
            <small>
              明确知情：
              {f.knownBy
                .map(
                  (k) =>
                    `${characters.find((c) => c.id === k.characterId)?.name ?? k.characterId}（时点 ${k.learnedAt ?? '未知'}）`,
                )
                .join('、') || '尚无声明'}
            </small>
          </article>
        ))}
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
export function WritingFinding({
  run,
  id,
  onClose,
  onEdit,
  onInstruct,
}: {
  run?: BackendRun;
  id: string;
  onClose: () => void;
  onEdit: () => void;
  onInstruct: () => void;
}) {
  const f = run?.result?.report.findings.find((f) => f.id === id);
  if (!f) return null;
  return (
    <aside className="finding-popover" aria-label="问题详情">
      <header>
        <Badge tone={f.severity === 'P0' ? 'danger' : 'muted'}>{f.severity}</Badge>
        <strong>{f.critic === 'hard_consistency' ? '一致性审查' : 'AI 味审查'}</strong>
        <Button size="sm" variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </header>
      <blockquote>{f.quote}</blockquote>
      <p>{f.reason}</p>
      <p>{f.suggestion}</p>
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
      <div className="page-actions">
        <Button size="sm" onClick={onEdit}>
          我来修改
        </Button>
        <Button
          size="sm"
          disabled={!!run?.instructionBlock}
          disabledReason={run?.instructionBlock}
          onClick={onInstruct}
        >
          下修改指令
        </Button>
      </div>
    </aside>
  );
}
