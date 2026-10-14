import ReviewPatch from './components/ReviewPatch';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Check, ArrowUpRight, MessageSquare, Undo2 } from 'lucide-react';
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
  Select,
  PageHeader,
  Field,
} from '@/shared/ui';
import type { Critic, RunActionInput, RunState, RepairScope } from '@/types/domain';
import { approveReview, reviewBlockers } from './gates';
import './review.css';
export default function ReviewPage() {
  const query = useChapter();
  const stale = useUIStore((s) => s.stale);
  const navigate = useNavigate();
  const [critic, setCritic] = useState<Critic | 'all'>('all');
  const [modal, setModal] = useState<'instruct' | 'redirect' | null>(null);
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<RepairScope>('segment');
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
  const selected = data?.findings.filter((f) => critic === 'all' || f.critic === critic) ?? [];
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
    <main className="page-content review-page">
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
              <ShieldCheck size={36} />
            </div>
            <div className="critic-grid">
              {(Object.keys(zh.critics) as Critic[]).map((key) => {
                const findings = data.findings.filter(
                  (f) => f.critic === key && f.status === 'open',
                );
                return (
                  <button
                    key={key}
                    className={`critic-card ${critic === key ? 'selected' : ''}`}
                    onClick={() => setCritic(critic === key ? 'all' : key)}
                  >
                    <span>{zh.critics[key]}</span>
                    <strong>{findings.length.toString().padStart(2, '0')}</strong>
                    <small>{findings.length ? t.review.pending : t.review.passed}</small>
                    <div>
                      {findings.slice(0, 4).map((f) => (
                        <Badge
                          key={f.id}
                          tone={
                            f.severity === 'P0'
                              ? 'danger'
                              : f.severity === 'P1'
                                ? 'warning'
                                : 'muted'
                          }
                        >
                          {f.severity}
                        </Badge>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
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
                            f.severity === 'P0'
                              ? 'danger'
                              : f.severity === 'P1'
                                ? 'warning'
                                : 'info'
                          }
                        >
                          {f.severity}
                        </Badge>
                        <Badge tone="muted">{zh.critics[f.critic]}</Badge>
                        <small>{zh.repair[f.repairScope]}</small>
                      </div>
                      <Badge tone={f.status === 'open' ? 'warning' : 'success'}>
                        {f.status === 'open' ? t.common.pending : t.common.done}
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
                          navigate('/workspace');
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
                    <p>{t.review.passed}</p>
                  </Card>
                )}
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
              </section>
              <aside className="review-gate">
                <Card>
                  <div className="section-title">
                    <ShieldCheck size={18} />
                    <h2>{t.review.gate}</h2>
                  </div>
                  {data.scores.items.map((score) => (
                    <div className="gate-metric" key={score.key}>
                      <div className="page-row">
                        <span>{score.label}</span>
                        <strong>{score.value}</strong>
                      </div>
                      <div className="page-row">
                        <small>
                          {score.direction === 'lower' ? '≤' : '≥'} {score.threshold}
                        </small>
                        <Badge
                          tone={!score.calibrated ? 'muted' : score.passed ? 'success' : 'danger'}
                        >
                          {!score.calibrated
                            ? zh.common.hint
                            : score.passed
                              ? t.review.passed
                              : t.review.pending}
                        </Badge>
                      </div>
                      <details>
                        <summary>{t.review.reason}</summary>
                        {score.features.map((f, i) => (
                          <p key={i}>
                            <strong>
                              {f.label} {f.value}
                            </strong>
                            <br />
                            {f.reason}
                            <br />
                            <small>{f.source}</small>
                          </p>
                        ))}
                      </details>
                    </div>
                  ))}
                  {blockers.length > 0 && (
                    <div className="gate-blockers">
                      {blockers.map((b, i) => (
                        <p key={i}>{b}</p>
                      ))}
                    </div>
                  )}
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
                    variant="human"
                    className="full-width"
                    disabled={!!blockers.length || action.isPending}
                    disabledReason={blockers.join('；')}
                    onClick={() => {
                      if (gate) void approveReview(action.mutateAsync, gate).catch(() => undefined);
                    }}
                  >
                    <Check size={15} />
                    {t.review.approve}
                  </Button>
                  <Button
                    className="full-width"
                    disabled={stale || action.isPending}
                    onClick={() => {
                      setModal('instruct');
                      setScope('segment');
                    }}
                  >
                    <MessageSquare size={15} />
                    {t.review.instruct}
                  </Button>
                  <Button
                    variant="ghost"
                    className="full-width"
                    disabled={stale || action.isPending}
                    onClick={() => {
                      setModal('redirect');
                      setScope('beat');
                    }}
                  >
                    <Undo2 size={15} />
                    {t.review.redirect}
                  </Button>
                  <p className="quiet">{t.review.approveHint}</p>
                  {action.error && (
                    <p role="alert" className="page-error">
                      {action.error.message}
                    </p>
                  )}
                </Card>
              </aside>
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
