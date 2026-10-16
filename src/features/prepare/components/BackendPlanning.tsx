import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUIStore } from '@/shared/lib/ui-store';
import { ApiError } from '@/shared/api/client';
import { Badge, Button, Card } from '@/shared/ui';
import { planningMessages as t } from '@/shared/lib/messages-planning';
import { planningApi, planningKey } from '../api/planning';
import { usePlanning } from '../hooks/usePlanning';
import type {
  DirectionRequest,
  PlanningIntake,
  PlanningJob,
  ToneDirection,
} from '../types/planning';
import PlanningIntakeForm, { emptyIntake } from './PlanningIntakeForm';
import DirectionEditor, { emptyDirection } from './DirectionEditor';
import './planning.css';

export default function BackendPlanning() {
  const query = usePlanning();
  const branchId = useUIStore((s) => s.branchId);
  const projectId = useUIStore((s) => s.projectId);
  const client = useQueryClient();
  const [draft, setDraft] = useState<{ version: number; intake: PlanningIntake } | null>(null);
  const [edit, setEdit] = useState<DirectionRequest | null>(null);
  const [jobID, setJobID] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const requestRef = useRef<{ id: string; version: number } | null>(null);
  const reload = () => client.invalidateQueries({ queryKey: planningKey });
  const onError = (error: Error) => {
    setNotice(
      error instanceof ApiError && error.body.code === 'version_mismatch'
        ? t.mismatch
        : error.message,
    );
    void reload();
  };
  const save = useMutation({
    mutationFn: ({ version, intake }: { version: number; intake: PlanningIntake }) =>
      planningApi.save(version, intake),
    onSuccess: async () => {
      setDraft(null);
      setNotice('');
      toast.success(t.saved);
      await reload();
    },
    onError,
  });
  const generate = useMutation({
    mutationFn: (version: number) => {
      if (!requestRef.current || requestRef.current.version !== version)
        requestRef.current = { id: crypto.randomUUID(), version };
      return planningApi.generate(requestRef.current.id, version);
    },
    onSuccess: async (job) => {
      requestRef.current = null;
      setJobID(job.id);
      setNotice('');
      await reload();
    },
    onError,
  });
  const select = useMutation({
    mutationFn: planningApi.select,
    onSuccess: async () => {
      setEdit(null);
      setNotice('');
      toast.success(t.selected);
      await reload();
    },
    onError,
  });
  const state = query.data;
  if (branchId !== 'main' || projectId !== 'project-zhuoliu')
    return (
      <Card>
        <h2>{t.title}</h2>
        <p>{t.mainOnly}</p>
      </Card>
    );
  if (!state)
    return (
      <Card className="planning-panel">
        <h2>{t.title}</h2>
        <p role={query.isError ? 'alert' : 'status'}>{query.isError ? t.error : t.loading}</p>
        {query.isError && <Button onClick={() => void query.refetch()}>{t.refresh}</Button>}
      </Card>
    );
  const version = state.input.version;
  const input = draft?.intake ?? (version ? state.input.intake : emptyIntake);
  const running = state.jobs.some((j) => j.status === 'running');
  const busy = save.isPending || generate.isPending || select.isPending;
  const job = state.jobs.find((j) => j.id === jobID) ?? state.jobs[0];
  const staleJob = job && job.input.version !== version;
  const staleEdit = Boolean(
    edit &&
    (edit.expectedInputVersion !== version ||
      edit.expectedDirectionVersion !== state.directionVersion ||
      draft),
  );
  const dirtyConflict = draft !== null && draft.version !== version;
  function openDirection(direction: ToneDirection, source?: PlanningJob, index = -1) {
    setEdit({
      expectedInputVersion: version,
      expectedDirectionVersion: state!.directionVersion,
      jobId: source?.id ?? '',
      candidateVersion: source?.version ?? 0,
      candidateIndex: index,
      direction: { ...direction },
    });
  }
  return (
    <section className="planning-panel" aria-label={t.title}>
      <div className="planning-heading">
        <h2>{t.title}</h2>
        <Badge>{t.source}</Badge>
        <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
          {t.refresh}
        </Button>
      </div>
      <p className="text-dim">{t.scope}</p>
      {query.isError && (
        <p role="alert" className="page-error">
          {t.error}
        </p>
      )}
      {notice && (
        <p role="alert" className="page-error">
          {notice}
        </p>
      )}
      {dirtyConflict && (
        <p role="alert" className="page-error">
          {t.mismatch} <Button onClick={() => setDraft(null)}>{t.loadSaved}</Button>
        </p>
      )}
      <PlanningIntakeForm
        value={input}
        packs={state.packs}
        disabled={busy}
        onChange={(intake) => setDraft({ version: draft?.version ?? version, intake })}
      />
      <div className="planning-actions">
        <Button
          disabled={!draft || !input.premise.trim() || dirtyConflict || busy}
          disabledReason={dirtyConflict ? t.mismatch : t.noChanges}
          loading={save.isPending}
          onClick={() => draft && save.mutate(draft)}
        >
          {t.save}
        </Button>
        <Button
          variant="default"
          disabled={!version || Boolean(draft) || running || busy || query.isError}
          disabledReason={draft ? t.dirty : t.cannotGenerate}
          loading={generate.isPending}
          onClick={() => generate.mutate(version)}
        >
          {t.generate}
        </Button>
        <Button
          variant="ghost"
          disabled={!version || Boolean(draft) || busy}
          disabledReason={t.cannotGenerate}
          onClick={() => openDirection(emptyDirection)}
        >
          {t.manual}
        </Button>
        <small className="text-dim">
          {t.inputVersion} v{version}
        </small>
      </div>
      {running && (
        <p role="status" className="planning-running">
          {t.generating}
        </p>
      )}
      {state.selection && (
        <div className="planning-selected">
          <div>
            <Badge tone={state.selection.inputVersion === version ? 'human' : 'warning'}>
              {t.current} · v{state.selection.version}
            </Badge>
            <strong>{state.selection.direction.title}</strong>
            <p>{state.selection.direction.logline}</p>
            {state.selection.inputVersion !== version && (
              <p className="page-error">{t.oldSelection}</p>
            )}
          </div>
          <Button
            disabled={Boolean(draft) || busy}
            disabledReason={t.dirty}
            onClick={() => openDirection(state.selection!.direction)}
          >
            {t.editCurrent}
          </Button>
        </div>
      )}
      <div className="planning-workbench">
        <div className="planning-candidates">
          <div className="planning-heading">
            <h3>{job ? t.status[job.status] : t.noCandidates}</h3>
            {job && <Badge>{job.model === 'scripted-fake' ? 'Fake 样例' : job.model}</Badge>}
          </div>
          {staleJob && <p className="page-error">{t.oldInput}</p>}
          {job?.message && <p role="status">{job.message}</p>}
          {!job && <p className="text-dim">{t.empty}</p>}
          {job?.directions.map((d, index) => (
            <button
              className="planning-candidate"
              key={`${job.id}-${index}`}
              aria-pressed={edit?.jobId === job.id && edit.candidateIndex === index}
              disabled={busy}
              onClick={() => openDirection(d, job, index)}
            >
              <strong>{d.title}</strong>
              <p>{d.logline}</p>
              <small>{t.choose}</small>
            </button>
          ))}
          <details className="planning-history">
            <summary>{t.history}</summary>
            {state.jobs.map((j) => (
              <button
                key={j.id}
                disabled={busy}
                onClick={() => {
                  setJobID(j.id);
                  setEdit(null);
                }}
              >
                <span>{new Date(j.createdAt).toLocaleString('zh-CN')}</span>
                <span>
                  {t.status[j.status]} · 立意 v{j.input.version}
                </span>
              </button>
            ))}
          </details>
          {job && (
            <details className="planning-trace">
              <summary>{t.trace}</summary>
              <p>
                输入 v{job.input.version} · {job.promptVersion} · {job.schemaVersion}
              </p>
              <p className="trace">{job.input.digest}</p>
              <p>{job.input.intake.premise}</p>
              {job.calls.map((c) => (
                <p key={c.number}>
                  #{c.number} · {c.phase} · {c.promptVersion} · {c.elapsedMs} ms ·{' '}
                  {c.usage.known
                    ? `${c.usage.inputTokens + c.usage.outputTokens} tokens`
                    : '用量未知'}
                </p>
              ))}
            </details>
          )}
        </div>
        {edit && (
          <DirectionEditor
            value={edit.direction}
            stale={
              staleEdit ||
              Boolean(
                edit.jobId &&
                state.jobs.find((j) => j.id === edit.jobId)?.input.version !== version,
              )
            }
            pending={select.isPending}
            onChange={(direction) => setEdit({ ...edit, direction })}
            onCancel={() => setEdit(null)}
            onSave={() => select.mutate(edit)}
          />
        )}
      </div>
    </section>
  );
}
