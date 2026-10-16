import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { Badge, Button, Card } from '@/shared/ui';
import { outlineMessages as t } from '@/shared/lib/messages-outline';
import { outlineApi } from '../api/outline';
import { planningKey } from '../api/planning';
import { usePlanning } from '../hooks/usePlanning';
import {
  outlineReady,
  planningVersions,
  sameVersions,
  type OutlineJob,
  type OutlineSaveRequest,
  type OutlineStartRequest,
} from '../types/outline';
import OutlineEditor from './OutlineEditor';
import './core-settings.css';
import './outline.css';
export default function BackendOutline() {
  const p = useUIStore((s) => s.projectId),
    b = useUIStore((s) => s.branchId);
  return p === 'project-zhuoliu' && b === 'main' ? (
    <OutlineWorkbench />
  ) : (
    <Card>
      <p>{t.mainOnly}</p>
    </Card>
  );
}
function OutlineWorkbench() {
  const query = usePlanning();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [request, setRequest] = useState(''),
    [count, setCount] = useState(6),
    [jobID, setJobID] = useState<string | null>(null),
    [edit, setEdit] = useState<OutlineSaveRequest | null>(null),
    [notice, setNotice] = useState(''),
    [rejected, setRejected] = useState(false);
  const requestKey = useRef<{ fingerprint: string; id: string } | null>(null);
  const reload = () => client.invalidateQueries({ queryKey: planningKey });
  const onError = (error: Error) => {
    const stale = error instanceof ApiError && error.body.code === 'version_mismatch';
    if (stale) setRejected(true);
    setNotice(stale ? t.stale : error.message);
    void reload();
  };
  const generate = useMutation({
    mutationFn: (body: Omit<OutlineStartRequest, 'requestId'>) => {
      const fingerprint = JSON.stringify(body);
      if (requestKey.current?.fingerprint !== fingerprint)
        requestKey.current = { fingerprint, id: crypto.randomUUID() };
      return outlineApi.generate({ ...body, requestId: requestKey.current.id });
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
    mutationFn: outlineApi.save,
    onSuccess: async () => {
      setEdit(null);
      setRejected(false);
      setNotice('');
      toast.success(t.saved);
      await reload();
    },
    onError,
  });
  const s = query.data;
  if (!s || !s.outlineJobs)
    return (
      <Card>
        <h2>{t.title}</h2>
        <p role={s || query.isError ? 'alert' : 'status'}>
          {s ? t.missing : query.isError ? t.error : t.loading}
        </p>
        <Button onClick={() => void query.refetch()}>{t.refresh}</Button>
      </Card>
    );
  const versions = planningVersions(s),
    ready = outlineReady(s),
    ov = s.outlineVersion ?? 0,
    selected = s.outlineSelection;
  const job = s.outlineJobs.find((j) => j.id === jobID) ?? s.outlineJobs[0];
  const oldJob = Boolean(job && !sameVersions(job.input.versions, versions));
  const running = s.outlineJobs.some((j) => j.status === 'running'),
    busy = generate.isPending || save.isPending;
  const oldSelected = Boolean(selected && !sameVersions(selected.versions, versions));
  const staleEdit = Boolean(
    edit &&
    (rejected ||
      query.isError ||
      !ready ||
      !sameVersions(edit.expected, versions) ||
      edit.expectedOutlineVersion !== ov),
  );
  const begin = (j: OutlineJob) => {
    if (!j.output) return;
    setNotice('');
    setRejected(false);
    setEdit({
      expected: versions,
      expectedOutlineVersion: ov,
      sourceOutlineVersion: 0,
      jobId: j.id,
      candidateVersion: j.version,
      content: structuredClone(j.output),
      confirmed: false,
    });
  };
  const review = () => {
    if (!selected) return;
    setNotice('');
    setRejected(false);
    setEdit({
      expected: versions,
      expectedOutlineVersion: ov,
      sourceOutlineVersion: selected.version,
      jobId: selected.jobId,
      candidateVersion: selected.candidateVersion,
      content: structuredClone(selected.content),
      confirmed: false,
    });
  };
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
              next.set('section', 'world');
              setParams(next);
            }}
          >
            {t.goCore}
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
            <Badge>
              {oldSelected ? t.needsReview : selected.confirmed ? t.confirmed : t.draft}
            </Badge>
            <Button
              disabled={Boolean(edit) || busy || !ready || query.isError}
              disabledReason={!ready ? t.prerequisite : edit ? t.editing : undefined}
              onClick={review}
            >
              {t.editSaved}
            </Button>
          </div>
          <p>
            {selected.content.chapters.length} {t.chapter} ·{' '}
            {selected.content.chapters.reduce((n, c) => n + c.targetWords, 0).toLocaleString()}{' '}
            {t.words}
          </p>
          {oldSelected && <p>{t.oldSelection}</p>}
          <ol className="outline-summary">
            {selected.content.chapters.map((ch) => (
              <li key={ch.id}>
                {ch.title} <span className="muted">{ch.purpose}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <div className="core-generate">
        <label>
          {t.request}
          <textarea
            rows={2}
            placeholder={t.placeholder}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </label>
        <div className="core-heading">
          <label>
            {t.count}
            <input
              type="number"
              min={2}
              max={12}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <Button
            variant="default"
            loading={generate.isPending}
            disabled={
              !ready ||
              busy ||
              running ||
              query.isError ||
              !request.trim() ||
              new TextEncoder().encode(request).length > 2400 ||
              !Number.isInteger(count) ||
              count < 2 ||
              count > 12
            }
            disabledReason={
              !ready
                ? t.prerequisite
                : running
                  ? t.running
                  : !request.trim()
                    ? t.placeholder
                    : undefined
            }
            onClick={() => generate.mutate({ expected: versions, request, chapterCount: count })}
          >
            {t.generate}
          </Button>
        </div>
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
                {s.outlineJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {new Date(j.createdAt).toLocaleString('zh-CN')} · {t.status[j.status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>{job.message}</p>
          {oldJob && <p>{t.oldJob}</p>}
          {job.output && (
            <>
              <p>
                {job.output.acts.map((a) => a.title).join(' / ')} · {job.output.chapters.length}{' '}
                {t.chapter}
              </p>
              <Button
                disabled={
                  Boolean(edit) ||
                  busy ||
                  !ready ||
                  query.isError ||
                  oldJob ||
                  job.status !== 'completed'
                }
                disabledReason={
                  oldJob ? t.oldJob : !ready ? t.prerequisite : edit ? t.editing : undefined
                }
                onClick={() => begin(job)}
              >
                {t.candidate}
              </Button>
            </>
          )}
          <details>
            <summary>{t.audit}</summary>
            <p>
              {t.versions}：{Object.values(job.input.versions).join(' / ')}
            </p>
            <p>
              {t.model}：{job.model} · {job.promptVersion} · {job.calls.length} {t.calls}
            </p>
            {job.calls.map((c) => (
              <p className="mono" key={c.number}>
                #{c.number} · {c.phase} · {c.elapsedMs} ms
              </p>
            ))}
          </details>
        </Card>
      )}
      {edit && s.coreSelection && (
        <>
          {staleEdit && <p role="alert">{t.stale}</p>}
          <OutlineEditor
            value={edit}
            core={s.coreSelection}
            onChange={setEdit}
            onSave={(confirmed) => save.mutate({ ...edit, confirmed })}
            onClose={() => {
              if (window.confirm(t.closeConfirm)) {
                setEdit(null);
                setRejected(false);
                setNotice('');
              }
            }}
            disabled={staleEdit}
            saving={save.isPending}
          />
        </>
      )}
    </section>
  );
}
