import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { Badge, Button, Card } from '@/shared/ui';
import { coreSettingsMessages as t } from '@/shared/lib/messages-core-settings';
import { coreSettingsApi } from '../api/core-settings';
import { planningKey } from '../api/planning';
import { usePlanning } from '../hooks/usePlanning';
import type { CoreJob, CoreSaveRequest, CoreStartRequest } from '../types/core-settings';
import CoreSettingsEditor, { pendingDecisions } from './CoreSettingsEditor';
import './core-settings.css';

export default function BackendCoreSettings() {
  const project = useUIStore((s) => s.projectId);
  const branch = useUIStore((s) => s.branchId);
  return project === 'project-zhuoliu' && branch === 'main' ? (
    <CoreWorkbench />
  ) : (
    <Card>
      <p>{t.mainOnly}</p>
    </Card>
  );
}
function CoreWorkbench() {
  const query = usePlanning();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [request, setRequest] = useState('');
  const [jobID, setJobID] = useState<string | null>(null);
  const [edit, setEdit] = useState<CoreSaveRequest | null>(null);
  const [notice, setNotice] = useState('');
  const [rejected, setRejected] = useState(false);
  const requestKey = useRef<{ fingerprint: string; id: string } | null>(null);
  const reload = () => client.invalidateQueries({ queryKey: planningKey });
  const onError = (error: Error) => {
    const stale = error instanceof ApiError && error.body.code === 'version_mismatch';
    if (stale) setRejected(true);
    setNotice(stale ? t.staleEdit : error.message);
    void reload();
  };
  const generate = useMutation({
    mutationFn: (body: Omit<CoreStartRequest, 'requestId'>) => {
      const fingerprint = JSON.stringify(body);
      if (requestKey.current?.fingerprint !== fingerprint)
        requestKey.current = { fingerprint, id: crypto.randomUUID() };
      return coreSettingsApi.generate({ ...body, requestId: requestKey.current.id });
    },
    onSuccess: async (job) => {
      requestKey.current = null;
      setJobID(job.id);
      setNotice('');
      await reload();
    },
    onError,
  });
  const save = useMutation({
    mutationFn: coreSettingsApi.save,
    onSuccess: async () => {
      setEdit(null);
      setRejected(false);
      setNotice('');
      toast.success(t.saved);
      await reload();
    },
    onError,
  });
  const state = query.data;
  if (!state || !state.coreJobs)
    return (
      <Card>
        <h2>{t.title}</h2>
        <p role={query.isError || state ? 'alert' : 'status'}>
          {state ? t.missingVersion : query.isError ? t.error : t.loading}
        </p>
        <Button onClick={() => void query.refetch()}>{t.refresh}</Button>
      </Card>
    );
  const iv = state.input.version,
    dv = state.directionVersion,
    sv = state.styleVersion,
    cv = state.coreVersion ?? 0;
  const ready = Boolean(
    state.selection?.inputVersion === iv &&
    state.styleSelection?.inputVersion === iv &&
    state.styleSelection?.directionVersion === dv &&
    state.styleSelection?.version === sv,
  );
  const running = state.coreJobs.some((j) => j.status === 'running');
  const busy = generate.isPending || save.isPending;
  const job = state.coreJobs.find((j) => j.id === jobID) ?? state.coreJobs[0];
  const selected = state.coreSelection;
  const oldJob = Boolean(
    job &&
    (job.input.source.version !== iv ||
      job.input.selection.version !== dv ||
      job.input.style.version !== sv),
  );
  const oldSelection = Boolean(
    selected &&
    (selected.inputVersion !== iv ||
      selected.directionVersion !== dv ||
      selected.styleVersion !== sv),
  );
  const staleEdit = Boolean(
    edit &&
    (rejected ||
      query.isError ||
      !ready ||
      edit.expectedInputVersion !== iv ||
      edit.expectedDirectionVersion !== dv ||
      edit.expectedStyleVersion !== sv ||
      edit.expectedCoreVersion !== cv),
  );
  function begin(job: CoreJob) {
    if (!job.output) return;
    setNotice('');
    setRejected(false);
    setEdit({
      expectedInputVersion: iv,
      expectedDirectionVersion: dv,
      expectedStyleVersion: sv,
      expectedCoreVersion: cv,
      sourceCoreVersion: 0,
      jobId: job.id,
      candidateVersion: job.version,
      content: structuredClone(job.output),
      decisions: pendingDecisions(job.output),
    });
  }
  function review() {
    if (!selected) return;
    setNotice('');
    setRejected(false);
    setEdit({
      expectedInputVersion: iv,
      expectedDirectionVersion: dv,
      expectedStyleVersion: sv,
      expectedCoreVersion: cv,
      sourceCoreVersion: selected.version,
      jobId: selected.jobId,
      candidateVersion: selected.candidateVersion,
      content: structuredClone(selected.content),
      decisions: oldSelection ? pendingDecisions(selected.content) : { ...selected.decisions },
    });
  }
  return (
    <section className="core-workbench" aria-label={t.title}>
      <div className="core-heading">
        <h2>{t.title}</h2>
        <Button size="sm" onClick={() => void query.refetch()}>
          {t.refresh}
        </Button>
      </div>
      <p className="muted">{t.boundary}</p>
      {!ready && (
        <div className="core-notice">
          <p>{t.prerequisite}</p>
          <Button
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('section', 'style');
              setParams(next);
            }}
          >
            {t.goStyle}
          </Button>
        </div>
      )}
      {query.isError && <p role="alert">{t.error}</p>}
      {notice && <p role="alert">{notice}</p>}
      {selected && (
        <Card>
          <div className="core-heading">
            <h3>
              {t.savedTitle} · v{selected.version}
            </h3>
            <Button
              disabled={Boolean(edit) || busy || !ready || query.isError}
              disabledReason={edit ? t.editingHint : !ready ? t.prerequisite : undefined}
              onClick={review}
            >
              {t.editSaved}
            </Button>
          </div>
          <p>
            {(['confirmed', 'pending', 'rejected'] as const).map((status) => (
              <span className="core-count" key={status}>
                {
                  Object.values(
                    oldSelection ? pendingDecisions(selected.content) : selected.decisions,
                  ).filter((s) => s === status).length
                }{' '}
                {t[status]}
              </span>
            ))}
          </p>
          {oldSelection && <p role="status">{t.oldSelection}</p>}
          <details>
            <summary>{t.readonly}</summary>
            {[
              ...selected.content.characters.map((c) => ({
                id: c.id,
                text: `${c.name} · ${c.want}`,
              })),
              ...selected.content.worldFacts.map((f) => ({ id: f.id, text: f.text })),
              ...selected.content.plans.map((p) => ({ id: p.id, text: p.intent })),
            ].map((item) => (
              <p key={item.id}>
                <Badge>{oldSelection ? t.pending : t[selected.decisions[item.id]]}</Badge>{' '}
                {item.text}
              </p>
            ))}
          </details>
        </Card>
      )}
      <div className="core-generate">
        <label>
          {t.request}
          <textarea
            rows={2}
            placeholder={t.requestPlaceholder}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </label>
        <Button
          variant="default"
          disabled={
            !ready ||
            busy ||
            running ||
            query.isError ||
            !request.trim() ||
            new TextEncoder().encode(request).length > 2400
          }
          disabledReason={
            !ready
              ? t.prerequisite
              : running
                ? t.running
                : !request.trim()
                  ? t.requestPlaceholder
                  : undefined
          }
          loading={generate.isPending}
          onClick={() =>
            generate.mutate({
              expectedInputVersion: iv,
              expectedDirectionVersion: dv,
              expectedStyleVersion: sv,
              request,
            })
          }
        >
          {t.generate}
        </Button>
      </div>
      {running && <p role="status">{t.running}</p>}
      {!job && <p>{t.empty}</p>}
      {job && (
        <Card>
          <div className="core-heading">
            <Badge>{t.status[job.status]}</Badge>
            <label>
              {t.history}
              <select value={job.id} onChange={(e) => setJobID(e.target.value)}>
                {state.coreJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {new Date(j.createdAt).toLocaleString('zh-CN')} · {t.status[j.status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>{job.message}</p>
          {oldJob && <p>{t.oldCandidate}</p>}
          {job.output && (
            <>
              <p>
                {job.output.characters.map((c) => c.name).join('、')} ·{' '}
                {job.output.worldFacts.length} {t.facts} · {job.output.plans.length} {t.plans}
              </p>
              <Button
                disabled={
                  Boolean(edit) ||
                  busy ||
                  oldJob ||
                  !ready ||
                  query.isError ||
                  job.status !== 'completed'
                }
                disabledReason={
                  oldJob
                    ? t.oldCandidate
                    : edit
                      ? t.editingHint
                      : !ready
                        ? t.prerequisite
                        : undefined
                }
                onClick={() => begin(job)}
              >
                {t.editCandidate}
              </Button>
            </>
          )}
          <details>
            <summary>{t.audit}</summary>
            <p>
              {t.versions}：{job.input.source.version} / {job.input.selection.version} /{' '}
              {job.input.style.version}
            </p>
            <p>
              {t.model}：{job.model} · {t.prompt}：{job.promptVersion} · {job.calls.length}{' '}
              {t.calls}
            </p>
            {job.calls.map((call) => (
              <p className="mono" key={call.number}>
                #{call.number} · {call.phase} · {call.elapsedMs} ms
              </p>
            ))}
          </details>
        </Card>
      )}
      {edit && (
        <>
          {cv > 0 && edit.sourceCoreVersion === 0 && <p>{t.replacing}</p>}
          {staleEdit && <p role="alert">{t.staleEdit}</p>}
          <CoreSettingsEditor
            value={edit}
            onChange={setEdit}
            disabled={staleEdit}
            saving={save.isPending}
            onSave={() => save.mutate(edit)}
            onClose={() => {
              if (window.confirm(t.discard)) {
                setEdit(null);
                setRejected(false);
                setNotice('');
              }
            }}
          />
        </>
      )}
    </section>
  );
}
