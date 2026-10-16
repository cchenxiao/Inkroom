import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, PenLine, UnlockKeyhole } from 'lucide-react';
import { ApiError } from '@/shared/api/client';
import { bookPath, enterBook } from '@/shared/lib/book-context';
import { wizardMessages as m } from '@/shared/lib/messages-wizard';
import { AsyncState, Badge, Button, Card, Empty, Field, Input, Textarea } from '@/shared/ui';
import type {
  BookBrief,
  BookPlan,
  PlanAction,
  PlanContent,
  PlanStep,
} from '@/types/domain/library';
import { libraryApi, libraryKeys, useBookPlan, usePlanAction } from './api';
import { WizardFields } from './components/WizardFields';
import './wizard.css';

type LocalDraft = { content: PlanContent; version: number; step: PlanStep; candidateId: string };
type LocalDrafts = Record<string, LocalDraft>;
const draftKey = (step: number, id: string) => `${step}:${id}`;

function validation(content: PlanContent, locking = false): string | null {
  if (
    content.kind === 'world' &&
    locking &&
    (!content.characters.length ||
      !content.rules.length ||
      content.characters.some((item) => !item.confirmed) ||
      content.rules.some((item) => !item.confirmed))
  )
    return m.worldConfirm;
  if (
    content.kind === 'style' &&
    (![content.sentenceMin, content.sentenceMax, content.dialogueMin, content.dialogueMax].every(
      Number.isFinite,
    ) ||
      content.sentenceMin < 1 ||
      content.sentenceMax > 200 ||
      content.sentenceMin > content.sentenceMax ||
      content.dialogueMin < 0 ||
      content.dialogueMax > 100 ||
      content.dialogueMin > content.dialogueMax)
  )
    return m.invalidStyle;
  return null;
}

function DemoNote() {
  return (
    <div className="wizard-demo">
      <Badge tone="warning">{m.demo}</Badge>
      <span>{m.demoHint}</span>
    </div>
  );
}

export default function WizardPage() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get('projectId') || '';
  const plan = useBookPlan(projectId);
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [brief, setBrief] = useState<BookBrief>({
    name: '',
    logline: '',
    genre: '',
    targetWords: 50000,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (
      !brief.name.trim() ||
      !brief.logline.trim() ||
      !brief.genre.trim() ||
      !Number.isInteger(brief.targetWords) ||
      brief.targetWords < 1000 ||
      brief.targetWords > 200000
    ) {
      setError(m.briefInvalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await libraryApi.create({
        ...brief,
        name: brief.name.trim(),
        genre: brief.genre.trim(),
        logline: brief.logline.trim(),
      });
      cache.setQueryData(libraryKeys.plan(created.projectId), created);
      await cache.invalidateQueries({ queryKey: libraryKeys.all });
      enterBook(created.projectId);
      setParams({ projectId: created.projectId, step: '0' }, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      setBusy(false);
    }
  }
  if (projectId)
    return (
      <AsyncState
        loading={plan.isLoading}
        error={!plan.data && plan.error}
        onRetry={() => void plan.refetch()}
      >
        {plan.data && <ExistingWizard key={projectId} plan={plan.data} />}
      </AsyncState>
    );
  return (
    <main className="wizard-page">
      <header className="wizard-heading">
        <div>
          <p>{m.eyebrow}</p>
          <h1>{m.title}</h1>
        </div>
        <Button variant="ghost" onClick={() => navigate('/library')}>
          <ArrowLeft size={15} />
          {m.backLibrary}
        </Button>
      </header>
      <DemoNote />
      <Card className="wizard-brief">
        <h2>{m.briefTitle}</h2>
        <p>{m.briefHint}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Field label={m.name}>
            <Input
              autoFocus
              required
              maxLength={120}
              placeholder={m.namePlaceholder}
              value={brief.name}
              disabled={busy}
              onChange={(event) => setBrief({ ...brief, name: event.target.value })}
            />
          </Field>
          <Field label={m.logline}>
            <Textarea
              required
              rows={4}
              placeholder={m.loglinePlaceholder}
              value={brief.logline}
              disabled={busy}
              onChange={(event) => setBrief({ ...brief, logline: event.target.value })}
            />
          </Field>
          <div className="wizard-field-grid">
            <Field label={m.genre}>
              <Input
                required
                placeholder={m.genrePlaceholder}
                value={brief.genre}
                disabled={busy}
                onChange={(event) => setBrief({ ...brief, genre: event.target.value })}
              />
            </Field>
            <Field label={m.targetWords}>
              <Input
                required
                type="number"
                min={1000}
                max={200000}
                step={1}
                value={Number.isFinite(brief.targetWords) ? brief.targetWords : ''}
                disabled={busy}
                onChange={(event) =>
                  setBrief({ ...brief, targetWords: event.target.valueAsNumber })
                }
              />
            </Field>
          </div>
          {error && (
            <p className="wizard-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="default" loading={busy}>
            <PenLine size={16} />
            {m.create}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function ExistingWizard({ plan }: { plan: BookPlan }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mutation = usePlanAction(plan.projectId);
  const cache = useQueryClient();
  const [drafts, setDrafts] = useState<LocalDrafts>({});
  const draftsRef = useRef(drafts);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const firstUnlocked = plan.steps.findIndex((item) => !item.locked);
  const furthest = firstUnlocked < 0 ? 3 : firstUnlocked;
  const rawStep = params.get('step');
  const requested = rawStep !== null && /^[0-3]$/.test(rawStep) ? Number(rawStep) : furthest;
  const step = Math.min(requested, furthest) as PlanStep;
  const current = plan.steps[step];
  const candidate =
    current.candidates.find((item) => item.id === previews[step]) ||
    current.candidates.find((item) => item.id === current.selectedId) ||
    current.candidates[0];
  const local = candidate ? drafts[draftKey(step, candidate.id)] : undefined;
  const content = local?.content || candidate?.content;
  const selected = !!candidate && candidate.id === current.selectedId;
  const dirty = Object.keys(drafts).length > 0;
  const conflict = Object.values(drafts).some((draft) => draft.version !== plan.version);
  const stale = Object.values(drafts).some(
    (draft) => !plan.steps[draft.step].candidates.some((item) => item.id === draft.candidateId),
  );
  const worldPending = content ? validation(content, true) : null;

  useEffect(() => {
    if (rawStep !== String(step)) {
      setParams({ projectId: plan.projectId, step: String(step) }, { replace: true });
      if (requested > furthest) setError(m.upstream);
    }
  }, [rawStep, step, plan.projectId, setParams, requested, furthest]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function updateDrafts(next: LocalDrafts) {
    draftsRef.current = next;
    setDrafts(next);
  }
  function edit(next: PlanContent) {
    if (!candidate) return;
    const key = draftKey(step, candidate.id);
    updateDrafts({
      ...draftsRef.current,
      [key]: {
        content: next,
        version: local?.version ?? plan.version,
        step,
        candidateId: candidate.id,
      },
    });
    setNotice('');
  }
  async function action(base: BookPlan, nextAction: PlanAction) {
    const result = await mutation.mutateAsync({ version: base.version, action: nextAction });
    updateDrafts(
      Object.fromEntries(
        Object.entries(draftsRef.current).map(([key, draft]) => [
          key,
          draft.version === base.version ? { ...draft, version: result.version } : draft,
        ]),
      ),
    );
    return result;
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? `${m.conflict} ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : m.error,
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveOne(base: BookPlan, draft: LocalDraft) {
    if (draft.version !== base.version) throw new Error(m.conflict);
    if (!base.steps[draft.step].candidates.some((item) => item.id === draft.candidateId))
      throw new Error(m.stale);
    const invalid = validation(draft.content);
    if (invalid) throw new Error(invalid);
    const content =
      draft.content.kind === 'style'
        ? {
            ...draft.content,
            bannedWords: draft.content.bannedWords.map((word) => word.trim()).filter(Boolean),
          }
        : draft.content;
    const result = await action(base, {
      action: 'edit',
      step: draft.step,
      candidateId: draft.candidateId,
      content,
    });
    const next = { ...draftsRef.current };
    delete next[draftKey(draft.step, draft.candidateId)];
    updateDrafts(next);
    return result;
  }
  async function saveAll() {
    let latest = plan;
    for (const key of Object.keys(draftsRef.current).sort()) {
      const draft = draftsRef.current[key];
      if (draft) latest = await saveOne(latest, draft);
    }
    return latest;
  }
  function move(next: number) {
    setParams({ projectId: plan.projectId, step: String(next) });
    setNotice('');
    setError('');
  }
  async function saveCurrent(lock: boolean) {
    if (!candidate || !content || !selected) throw new Error(m.chooseFirst);
    const invalid = validation(content, lock);
    if (invalid) throw new Error(invalid);
    const latest = await saveOne(
      plan,
      local || { content, version: plan.version, step, candidateId: candidate.id },
    );
    if (lock) await action(latest, { action: 'lock', step });
    setNotice(lock ? m.savedLocked : m.saved);
  }
  async function exit() {
    await saveAll();
    enterBook(plan.projectId);
    navigate(bookPath(plan.projectId));
  }
  const saveDisabled = busy || conflict || stale;

  return (
    <main className="wizard-page">
      <header className="wizard-heading">
        <div>
          <p>
            {m.editTitle} / {m.stepCount(step)}
          </p>
          <h1>{plan.brief.name}</h1>
          <span className="wizard-muted">{plan.brief.logline}</span>
        </div>
        <Button onClick={() => void run(exit)} disabled={saveDisabled} loading={busy}>
          {m.saveExit}
        </Button>
      </header>
      <DemoNote />
      <nav className="wizard-steps" aria-label={m.editTitle}>
        {m.steps.map((label, index) => (
          <button
            key={label}
            aria-current={index === step ? 'step' : undefined}
            disabled={index > furthest || busy}
            className={index === step ? 'active' : ''}
            onClick={() => move(index)}
            title={index > furthest ? m.blocked : label}
          >
            <span className="wizard-step-number">
              {plan.steps[index].locked ? <Check size={16} /> : index + 1}
            </span>
            <span>
              <strong>{label}</strong>
              <small>
                {plan.steps[index].locked ? m.locked : index > furthest ? m.blocked : m.pending}
              </small>
            </span>
          </button>
        ))}
      </nav>
      {(error || conflict || stale) && (
        <div className="wizard-error" role="alert">
          {error || (stale ? m.stale : m.conflict)}
        </div>
      )}
      {notice && (
        <p className="wizard-notice" role="status">
          {notice}
        </p>
      )}
      {dirty && (
        <div className="wizard-dirty">
          <Badge tone="warning">{m.dirty}</Badge>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              updateDrafts({});
              setError('');
              void cache.invalidateQueries({ queryKey: libraryKeys.plan(plan.projectId) });
            }}
          >
            {m.discardAll}
          </Button>
        </div>
      )}
      <section className="wizard-section-heading">
        <div>
          <h2>{m.steps[step]}</h2>
          <p>{m.descriptions[step]}</p>
        </div>
        <div className="wizard-heading-actions">
          {current.locked && (
            <Badge tone="success">
              <LockKeyhole size={12} />
              {m.locked}
            </Badge>
          )}
          <Button
            disabled={busy || current.locked || dirty}
            disabledReason={current.locked ? m.lockedHint : dirty ? m.pendingLocal : undefined}
            onClick={() =>
              void run(async () => {
                await action(plan, { action: 'generate', step });
                setPreviews((value) => {
                  const next = { ...value };
                  delete next[step];
                  return next;
                });
              })
            }
          >
            <PenLine size={15} />
            {current.candidates.length ? m.regenerate : m.generate}
          </Button>
        </div>
      </section>
      {!candidate ? (
        <Card className="wizard-empty">
          <Empty title={m.emptyTitle} description={m.emptyHint} />
        </Card>
      ) : (
        <div className="wizard-workbench">
          <aside className="wizard-candidates" aria-label={m.candidates}>
            {current.candidates.map((item, index) => (
              <button
                key={item.id}
                className={`wizard-candidate ${candidate.id === item.id ? 'active' : ''}`}
                aria-pressed={candidate.id === item.id}
                disabled={busy}
                onClick={() => setPreviews({ ...previews, [step]: item.id })}
              >
                <div>
                  <Badge tone="ai">
                    {m.mockCandidate} {index + 1}
                  </Badge>
                  {item.id === current.selectedId && <Badge tone="human">{m.chosen}</Badge>}
                </div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                {drafts[draftKey(step, item.id)] && <small>{m.dirty}</small>}
              </button>
            ))}
          </aside>
          <Card className="wizard-detail">
            <header>
              <div>
                <Badge tone={selected ? 'human' : 'muted'}>{selected ? m.chosen : m.preview}</Badge>
                <h3>{candidate.title}</h3>
                <p>{current.locked ? m.lockedHint : selected ? m.editHint : m.previewHint}</p>
              </div>
              {!selected && (
                <Button
                  variant="default"
                  disabled={busy || current.locked || conflict}
                  onClick={() =>
                    void run(async () => {
                      await action(plan, { action: 'select', step, candidateId: candidate.id });
                    })
                  }
                >
                  {m.choose}
                </Button>
              )}
              {current.locked && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await action(plan, { action: 'unlock', step });
                    })
                  }
                >
                  <UnlockKeyhole size={15} />
                  {m.unlock}
                </Button>
              )}
            </header>
            {content && (
              <WizardFields
                content={content}
                disabled={busy || current.locked || !selected}
                onChange={edit}
              />
            )}
            {selected && !current.locked && (
              <footer className="wizard-editor-actions">
                {local && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      const next = { ...draftsRef.current };
                      delete next[draftKey(step, candidate.id)];
                      updateDrafts(next);
                      setError('');
                    }}
                  >
                    {m.discard}
                  </Button>
                )}
                <Button disabled={saveDisabled} onClick={() => void run(() => saveCurrent(false))}>
                  {m.save}
                </Button>
                <Button
                  variant="human"
                  disabled={saveDisabled || !!worldPending}
                  disabledReason={worldPending || undefined}
                  onClick={() => void run(() => saveCurrent(true))}
                >
                  <LockKeyhole size={14} />
                  {m.lock}
                </Button>
                {worldPending && <p className="wizard-muted">{worldPending}</p>}
              </footer>
            )}
          </Card>
        </div>
      )}
      <footer className="wizard-navigation">
        <Button disabled={busy || step === 0} onClick={() => move(step - 1)}>
          <ArrowLeft size={15} />
          {m.previous}
        </Button>
        <span className="wizard-muted">{m.stepCount(step)}</span>
        {step < 3 ? (
          <Button
            variant="default"
            disabled={busy || !current.locked}
            disabledReason={!current.locked ? m.blocked : undefined}
            onClick={() => move(step + 1)}
          >
            {m.next}
            <ArrowRight size={15} />
          </Button>
        ) : (
          <Button
            variant="default"
            disabled={saveDisabled || !current.locked}
            onClick={() => void run(exit)}
          >
            {m.finish}
            <Check size={15} />
          </Button>
        )}
      </footer>
    </main>
  );
}
