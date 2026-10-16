import { editorialPages as e } from '@/shared/lib/messages-editorial-pages';
import { QualityGateCard } from '@/shared/ui/quality-gate-card';
import ReviewPatch from './components/ReviewPatch';
import { useState } from 'react';
import { studio } from '@/shared/lib/messages-studio';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Check, ArrowUpRight, MessageSquare } from 'lucide-react';
import { useAction, useChapter } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import { zh } from '@/shared/lib/messages';
import {
  Button,
  Badge,
  Card,
  Modal,
  AsyncState,
  Textarea,
  Input,
  Select,
  PageHeader,
  Field,
} from '@/shared/ui';
import type { Critic, RunActionInput, RunState, RepairScope } from '@/types/domain';
import { approveReview, reviewBlockers } from './gates';
import './review.css';
export default function ReviewPage({ embedded = false }: { embedded?: boolean } = {}) {
  const query = useChapter();
  const stale = useUIStore((s) => s.stale);
  const navigate = useNavigate();
  const [critic, setCritic] = useState<Critic | 'all'>('all');
  const [modal, setModal] = useState<'redirect' | null>(null);
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<RepairScope>('segment');
  const [inlineScope, setInlineScope] = useState<RepairScope>('segment');
  const data = query.data;
  const action = useAction<RunState, RunActionInput>(`/runs/${data?.run.id ?? ''}/actions`);
  const gate = data
    ? {
        scores: data.scores,
        stale,
        currentVersion: data.chapter.draftVersion,
        reviewVersion: data.run.draftVersion,
      }
    : null;
  const blockers = gate ? reviewBlockers(gate) : [];
  const waiting = data && ['waiting_human', 'escalated'].includes(data.run.status);
  if (!waiting) blockers.push(t.review.noRun);
  const selected =
    data?.findings
      .filter((f) => critic === 'all' || f.critic === critic)
      .sort(
        (a, b) =>
          Number(a.status !== 'open') - Number(b.status !== 'open') ||
          a.severity.localeCompare(b.severity),
      ) ?? [];
  const sendInstruction = async () => {
    if (!data || !modal) return;
    await action.mutateAsync({
      action: modal,
      instruction,
      scope,
      draftVersion: data.chapter.draftVersion,
    });
    setModal(null);
  };
  return (
    <main className={embedded ? 'review-page review-embedded' : 'page-content review-page'}>
      {!embedded && (
        <PageHeader
          eyebrow={t.review.eyebrow}
          title={t.review.title}
          description={t.review.description}
          actions={
            <Button variant="ghost" onClick={() => navigate('/workspace')}>
              {t.common.back}
              <ArrowUpRight size={14} />
            </Button>
          }
        />
      )}
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={!data}
      >
        {data && (
          <>
            <div className="review-banner">
              <div>
                <Badge tone="human">{t.common.author}</Badge>
                <h2>
                  {data.chapter.title} <span>v{data.chapter.draftVersion}</span>
                </h2>
                <p>{waiting ? t.review.runReady : zh.nodes[data.run.currentNode]}</p>
              </div>
              <ShieldCheck size={20} />
            </div>
            <nav className="critic-grid" aria-label={e.review.groups}>
              <button
                className={`critic-card ${critic === 'all' ? 'selected' : ''}`}
                onClick={() => setCritic('all')}
                aria-pressed={critic === 'all'}
              >
                {e.review.all}{' '}
                <strong>{data.findings.filter((f) => f.status === 'open').length}</strong>
              </button>
              {(Object.keys(zh.critics) as Critic[]).map((key) => {
                const findings = data.findings.filter(
                  (f) => f.critic === key && f.status === 'open',
                );
                const planned = key === 'style' || key === 'reader';
                return (
                  <button
                    key={key}
                    className={`critic-card ${critic === key ? 'selected' : ''}`}
                    aria-pressed={critic === key}
                    onClick={() => setCritic(key)}
                  >
                    <span>{zh.critics[key]}</span>
                    {!planned && <strong>{findings.length}</strong>}
                    <small>
                      {planned
                        ? embedded
                          ? e.review.planned
                          : `${e.review.planned} · ${e.review.examples}`
                        : e.review.wired}
                      {key === 'reader' && !embedded ? ` · ${e.review.readerHint}` : ''}
                    </small>
                  </button>
                );
              })}
            </nav>
            <div className="review-columns">
              <section className="page-stack">
                <div className="section-title">
                  <h2>{t.review.critics}</h2>
                  <Button variant="ghost" size="sm" onClick={() => setCritic('all')}>
                    {t.review.all}
                  </Button>
                </div>
                {selected.map((f) => (
                  <Card className="review-finding" key={f.id}>
                    <div className="page-row">
                      <div className="voice-tags">
                        <Badge
                          tone={
                            f.critic === 'reader'
                              ? 'muted'
                              : f.severity === 'P0'
                                ? 'danger'
                                : f.severity === 'P1'
                                  ? 'warning'
                                  : 'info'
                          }
                        >
                          {f.critic === 'reader' ? e.review.advice : f.severity}
                        </Badge>
                        <Badge tone="muted">{zh.critics[f.critic]}</Badge>
                        <small>{zh.repair[f.repairScope]}</small>
                      </div>
                      <Badge
                        tone={
                          f.critic === 'reader'
                            ? 'muted'
                            : f.status === 'open'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {f.critic === 'reader'
                          ? e.review.nonBlocking
                          : f.status === 'open'
                            ? t.common.pending
                            : t.common.done}
                      </Badge>
                    </div>
                    <blockquote>{f.quote}</blockquote>
                    <p>{f.reason}</p>
                    <p className="quiet">
                      {t.review.suggestion} · {f.suggestion}
                    </p>
                    <div className="page-row">
                      <small>
                        {t.review.evidence} · {f.evidenceRefs.join(' · ')}
                      </small>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          useUIStore.getState().selectSegment(f.segmentId);
                          useUIStore.getState().selectFinding(f.id);
                          if (!embedded) navigate('/workspace');
                        }}
                      >
                        {t.common.locate}
                        <ArrowUpRight size={12} />
                      </Button>
                    </div>
                  </Card>
                ))}
                {!selected.length && (
                  <Card>
                    <Check size={18} />
                    <p>
                      {critic === 'style' || critic === 'reader'
                        ? e.review.unconnected
                        : t.review.passed}
                    </p>
                  </Card>
                )}
                {!embedded && (
                  <>
                    <div className="section-title">
                      <h2>{t.review.diff}</h2>
                      <Badge tone="ai">
                        {data.patches.filter((p) => p.status === 'pending').length}
                      </Badge>
                    </div>
                    {data.patches.length ? (
                      data.patches.map((p) => (
                        <ReviewPatch key={p.id} patch={p} version={data.chapter.draftVersion} />
                      ))
                    ) : (
                      <Card>
                        <p className="quiet">{t.review.noDiff}</p>
                      </Card>
                    )}
                  </>
                )}
              </section>
              <aside className="review-gate">
                <details open={embedded ? undefined : true}>
                  <summary>{studio.gateDetails}</summary>
                  <QualityGateCard scores={data.scores} blockers={blockers} />
                </details>
                {stale && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void query
                        .refetch()
                        .then((result) => {
                          if (result.data && !result.error) useUIStore.getState().setStale(false);
                        })
                        .catch(() => undefined)
                    }
                  >
                    {t.review.reviewed}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={stale || action.isPending}
                  onClick={() => {
                    setModal('redirect');
                    setScope('beat');
                  }}
                >
                  {t.review.redirect}
                </Button>
              </aside>
            </div>
            <div className="review-decision-bar">
              <div className="review-decision-status">
                <strong>
                  v{data.chapter.draftVersion} ·{' '}
                  {blockers.length ? `${blockers.length} ${e.review.blocked}` : e.review.ready}
                </strong>
                <small>{t.review.approveHint}</small>
              </div>
              <div className="review-decision-actions">
                <Button
                  variant="human"
                  disabled={!!blockers.length || action.isPending}
                  disabledReason={blockers.join('；')}
                  onClick={() => {
                    if (gate) void approveReview(action.mutateAsync, gate).catch(() => undefined);
                  }}
                >
                  <Check size={15} />
                  {e.review.approve}
                </Button>
                <div className="review-inline-instruction">
                  <Select
                    aria-label={t.review.scope}
                    value={inlineScope}
                    onChange={(event) => setInlineScope(event.target.value as RepairScope)}
                    disabled={stale || action.isPending}
                  >
                    {(Object.keys(zh.repair) as RepairScope[]).map((key) => (
                      <option key={key} value={key}>
                        {zh.repair[key]}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={e.review.instruction}
                    placeholder={e.review.placeholder}
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    disabled={stale || action.isPending}
                  />
                  <Button
                    variant="ghost"
                    disabled={!instruction.trim() || stale || action.isPending}
                    onClick={() => {
                      if (!data) return;
                      void action
                        .mutateAsync({
                          action: 'instruct',
                          instruction,
                          scope: inlineScope,
                          draftVersion: data.chapter.draftVersion,
                        })
                        .then(() => setInstruction(''))
                        .catch(() => undefined);
                    }}
                  >
                    <MessageSquare size={15} />
                    {e.review.instruct}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const finding = selected.find((f) => f.status === 'open');
                    if (finding) {
                      useUIStore.getState().selectSegment(finding.segmentId);
                      useUIStore.getState().selectFinding(finding.id);
                    }
                    if (embedded) useUIStore.getState().setAttention(null);
                    else navigate('/workspace');
                  }}
                >
                  <ArrowUpRight size={15} />
                  {e.review.edit}
                </Button>

                {action.error && (
                  <p role="alert" className="page-error">
                    {action.error.message}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </AsyncState>
      <Modal
        open={!!modal}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
        title={modal === 'redirect' ? t.review.redirect : t.review.instruct}
        footer={
          <Button
            variant="human"
            disabled={!instruction.trim() || action.isPending || stale}
            onClick={() => void sendInstruction().catch(() => undefined)}
          >
            {modal === 'redirect' ? t.review.redirect : t.review.instruct}
          </Button>
        }
      >
        <div className="page-form">
          <Field label={t.review.scope}>
            <Select value={scope} onChange={(e) => setScope(e.target.value as RepairScope)}>
              {(Object.keys(zh.repair) as RepairScope[])
                .filter((key) => modal !== 'redirect' || ['beat', 'outline'].includes(key))
                .map((key) => (
                  <option key={key} value={key}>
                    {zh.repair[key]}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t.review.instruction}>
            <Textarea
              rows={5}
              placeholder={t.review.instructionPlaceholder}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </Field>
          {action.error && (
            <p role="alert" className="page-error">
              {action.error.message}
            </p>
          )}
        </div>
      </Modal>
    </main>
  );
}
