import ReferenceStyleAnalysis from './ReferenceStyleAnalysis';
import type { StyleAnalysisJob } from '../types/style-analysis';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { Badge, Button, Card } from '@/shared/ui';
import { planningMessages as p } from '@/shared/lib/messages-planning';
import { styleTrialMessages as t } from '@/shared/lib/messages-style-trial';
import { planningApi, planningKey } from '../api/planning';
import { usePlanning } from '../hooks/usePlanning';
import type { StyleSelectionRequest, TrialSetup } from '../types/style-trial';
import StyleTrialSetup, { emptyTrialSetup, validSetup, lines } from './StyleTrialSetup';
import StyleTrialSamples from './StyleTrialSamples';
import StyleSelectionEditor from './StyleSelectionEditor';
import './planning.css';
import './style-trial.css';

export default function BackendStyleTrial() {
  const projectId = useUIStore((s) => s.projectId);
  const branchId = useUIStore((s) => s.branchId);
  if (projectId !== 'project-zhuoliu' || branchId !== 'main')
    return (
      <Card>
        <p>{t.mainOnly}</p>
      </Card>
    );
  return <StyleTrialWorkbench />;
}
function StyleTrialWorkbench() {
  const query = usePlanning();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [setup, setSetup] = useState<TrialSetup>(emptyTrialSetup);
  const [edit, setEdit] = useState<StyleSelectionRequest | null>(null);
  const [jobID, setJobID] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [rejected, setRejected] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const reload = () => client.invalidateQueries({ queryKey: planningKey });
  const onError = (error: Error) => {
    const mismatch = error instanceof ApiError && error.body.code === 'version_mismatch';
    setNotice(mismatch ? t.staleEdit : error.message);
    if (mismatch) setRejected(true);
    void reload();
  };
  const generate = useMutation({
    mutationFn: (body: Omit<Parameters<typeof planningApi.generateTrial>[0], 'requestId'>) => {
      const fingerprint = JSON.stringify(body);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      return planningApi.generateTrial({ ...body, requestId: request.current.id });
    },
    onSuccess: async (job) => {
      request.current = null;
      setJobID(job.id);
      setNotice('');
      await reload();
    },
    onError,
  });
  const adopt = useMutation({
    mutationFn: planningApi.selectStyle,
    onSuccess: async () => {
      setEdit(null);
      setNotice('');
      setRejected(false);
      toast.success(t.saved);
      await reload();
    },
    onError,
  });
  const state = query.data;
  if (!state || !state.styleJobs)
    return (
      <Card>
        <h2>{t.title}</h2>
        <p role={query.isError || state ? 'alert' : 'status'}>
          {query.isError || state ? p.error : p.loading}
        </p>
        <Button onClick={() => void query.refetch()}>{p.refresh}</Button>
      </Card>
    );
  const iv = state.input.version;
  const dv = state.directionVersion;
  const directionReady = Boolean(state.selection && state.selection.inputVersion === iv);
  const job = state.styleJobs.find((j) => j.id === jobID) ?? state.styleJobs[0];
  const staleJob = Boolean(
    job && (job.report.input.source.version !== iv || job.report.input.selection.version !== dv),
  );
  const running = state.styleJobs.some((j) => j.report.status === 'running');
  const busy = generate.isPending || adopt.isPending;
  const staleEdit = Boolean(
    edit &&
    (rejected ||
      query.isError ||
      edit.expectedInputVersion !== iv ||
      edit.expectedDirectionVersion !== dv ||
      edit.expectedStyleVersion !== state.styleVersion),
  );
  const selected = state.styleSelection;
  const oldSelected =
    selected && (selected.inputVersion !== iv || selected.directionVersion !== dv);
  function choose(index: number) {
    if (!job) return;
    const sample = job.report.samples[index];
    setRejected(false);
    setEdit({
      expectedInputVersion: job.report.input.source.version,
      expectedDirectionVersion: job.report.input.selection.version,
      expectedStyleVersion: state!.styleVersion,
      jobId: job.id,
      candidateVersion: job.version,
      variantId: sample.variant.id,
      anchorText: sample.text,
      rules: {
        pov: job.report.input.beat.pov,
        tense: job.report.input.beat.tense,
        tone: sample.variant.instructions,
        sentenceLength: { min: 8, max: 35 },
        dialogueRatio: { min: 0.1, max: 0.5 },
        bannedPhrases: sample.variant.bannedPhrases,
        styleArc: '',
      },
    });
  }
  function useAnalysis(analysis: StyleAnalysisJob) {
    if (!analysis.output) return;
    setRejected(false);
    setEdit({
      expectedInputVersion: iv,
      expectedDirectionVersion: dv,
      expectedStyleVersion: state!.styleVersion,
      sourceStyleVersion: 0,
      jobId: '',
      candidateVersion: 0,
      variantId: '',
      analysisId: analysis.id,
      analysisVersion: analysis.version,
      anchorText: analysis.output.anchorText,
      rules: structuredClone(analysis.output.rules),
    });
  }
  function manual() {
    setRejected(false);
    setEdit({
      expectedInputVersion: iv,
      expectedDirectionVersion: dv,
      expectedStyleVersion: state!.styleVersion,
      jobId: selected?.jobId ?? '',
      candidateVersion: selected?.candidateVersion ?? 0,
      variantId: selected?.variantId ?? '',
      sourceStyleVersion: selected?.version ?? 0,
      analysisId: selected?.analysisId ?? '',
      analysisVersion: selected?.analysisVersion ?? 0,
      anchorText: selected?.anchorText ?? '',
      rules: selected
        ? structuredClone(selected.rules)
        : {
            pov: '',
            tense: '',
            tone: state!.selection?.direction.tone ?? '',
            sentenceLength: { min: 8, max: 35 },
            dialogueRatio: { min: 0.1, max: 0.5 },
            bannedPhrases: [],
            styleArc: '',
          },
    });
  }
  return (
    <section className="planning-panel" aria-label={t.title}>
      <div className="planning-heading">
        <h2>{t.title}</h2>
        <Badge>{p.source}</Badge>
        <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
          {p.refresh}
        </Button>
      </div>
      <p className="text-dim">{t.boundary}</p>
      {notice && (
        <p role="alert" className="page-error">
          {notice}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="page-error">
          {p.error}
        </p>
      )}
      {!directionReady ? (
        <div className="planning-selected">
          <p>{t.needDirection}</p>
          <Button
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('section', 'premise');
              setParams(next);
            }}
          >
            {t.goPremise}
          </Button>
        </div>
      ) : (
        <p>
          {p.current} · v{dv} · {state.selection!.direction.title}
        </p>
      )}
      <div className="planning-actions">
        <Button
          disabled={!directionReady || busy || query.isError}
          disabledReason={t.needDirection}
          onClick={manual}
        >
          {selected ? t.editSaved : t.manual}
        </Button>
      </div>
      {selected && (
        <div className="planning-selected">
          <div>
            <Badge tone={oldSelected ? 'warning' : 'human'}>
              {oldSelected ? t.pendingReview : t.selected} · v{selected.version}
            </Badge>
            <p>
              {selected.rules.pov} · {selected.rules.tense} · {selected.rules.tone}
            </p>
            <details>
              <summary>{t.savedDetail}</summary>
              <p className="style-sample-prose">{selected.anchorText}</p>
              <p>
                锚文本 v{selected.anchorVersion} · 方向 v{selected.directionVersion}
              </p>
              <p>
                {t.sentence}：{selected.rules.sentenceLength.min}–
                {selected.rules.sentenceLength.max}；{t.dialogue}：
                {Math.round(selected.rules.dialogueRatio.min * 100)}–
                {Math.round(selected.rules.dialogueRatio.max * 100)}
              </p>
              <p>
                {t.arc}：{selected.rules.styleArc || '—'}
              </p>
              <p>
                {t.banned}：{selected.rules.bannedPhrases.join('；') || '—'}
              </p>
            </details>
          </div>
        </div>
      )}
      <ReferenceStyleAnalysis
        canUse={directionReady && !busy && !query.isError}
        onUse={useAnalysis}
      />
      <details className="style-trial-setup" open={!job || undefined}>
        <summary>{t.setup}</summary>
        <StyleTrialSetup value={setup} onChange={setSetup} disabled={busy || running} />
        <Button
          variant="default"
          disabled={!directionReady || !validSetup(setup) || busy || running || query.isError}
          disabledReason={running ? t.running : t.cannotGenerate}
          loading={generate.isPending}
          onClick={() =>
            generate.mutate({
              ...setup,
              beat: { ...setup.beat, facts: lines(setup.beat.facts.join('\n')) },
              variants: setup.variants.map((v) => ({
                ...v,
                bannedPhrases: lines(v.bannedPhrases.join('\n')),
              })),
              expectedInputVersion: iv,
              expectedDirectionVersion: dv,
            })
          }
        >
          {t.generate}
        </Button>
      </details>
      {!job && <p className="text-dim">{t.empty}</p>}
      {running && job?.report.status !== 'running' && <p role="status">{t.running}</p>}
      {job && (
        <StyleTrialSamples
          job={job}
          stale={staleJob}
          busy={busy || query.isError}
          onChoose={choose}
        />
      )}
      {edit && (
        <StyleSelectionEditor
          value={edit}
          stale={staleEdit}
          pending={adopt.isPending}
          onChange={setEdit}
          onCancel={() => {
            setEdit(null);
            setRejected(false);
          }}
          onSave={() =>
            adopt.mutate({
              ...edit,
              rules: { ...edit.rules, bannedPhrases: lines(edit.rules.bannedPhrases.join('\n')) },
            })
          }
        />
      )}
      <details className="planning-history">
        <summary>{t.history}</summary>
        {state.styleJobs.map((j) => (
          <button
            key={j.id}
            disabled={busy}
            onClick={() => {
              setJobID(j.id);
            }}
          >
            <span>{new Date(j.createdAt).toLocaleString('zh-CN')}</span>
            <span>
              {p.status[j.report.status]} · 方向 v{j.report.input.selection.version}
            </span>
          </button>
        ))}
      </details>
    </section>
  );
}
