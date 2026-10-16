import PlannedBeatWriting from './PlannedBeatWriting';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { Badge, Button, Card } from '@/shared/ui';
import { chapterPlanMessages as t } from '@/shared/lib/messages-chapter-plan';
import { chapterPlanApi } from '../api/chapter-plan';
import { planningKey } from '../api/planning';
import { usePlanning } from '../hooks/usePlanning';
import {
  chapterPlanReady,
  chapterPlanVersions,
  sameChapterPlanVersions,
  type ChapterPlanSaveRequest,
  type ChapterPlanStartRequest,
} from '../types/chapter-plan';
import ChapterPlanEditor from './ChapterPlanEditor';
import './core-settings.css';
import './outline.css';
export default function BackendChapterPlan() {
  const project = useUIStore((s) => s.projectId),
    branch = useUIStore((s) => s.branchId);
  return project === 'project-zhuoliu' && branch === 'main' ? <ChapterPlanWorkbench /> : null;
}
function ChapterPlanWorkbench() {
  const query = usePlanning(),
    client = useQueryClient();
  const [chapterID, setChapterID] = useState(''),
    [jobID, setJobID] = useState(''),
    [request, setRequest] = useState('');
  const [edit, setEdit] = useState<ChapterPlanSaveRequest | null>(null),
    [notice, setNotice] = useState(''),
    [rejected, setRejected] = useState(false);
  const requestKey = useRef<{ fingerprint: string; id: string } | null>(null);
  const reload = () => client.invalidateQueries({ queryKey: planningKey });
  const onError = (e: Error) => {
    const stale = e instanceof ApiError && e.body.code === 'version_mismatch';
    if (stale) setRejected(true);
    setNotice(stale ? t.stale : e.message);
    void reload();
  };
  const generate = useMutation({
    mutationFn: (body: Omit<ChapterPlanStartRequest, 'requestId'>) => {
      const fingerprint = JSON.stringify(body);
      if (requestKey.current?.fingerprint !== fingerprint)
        requestKey.current = { fingerprint, id: crypto.randomUUID() };
      return chapterPlanApi.generate({ ...body, requestId: requestKey.current.id });
    },
    onSuccess: async (j) => {
      requestKey.current = null;
      setJobID(j.id);
      setNotice('');
      await reload();
    },
    onError,
  });
  const save = useMutation({
    mutationFn: chapterPlanApi.save,
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
  if (!s || !s.chapterPlans || !s.chapterPlanJobs)
    return (
      <Card>
        <h2>{t.title}</h2>
        <p role={query.isError || s ? 'alert' : 'status'}>
          {s ? t.missing : query.isError ? t.error : t.loading}
        </p>
        <Button onClick={() => void query.refetch()}>{t.refresh}</Button>
      </Card>
    );
  const chapters = s.outlineSelection?.content.chapters ?? [];
  const chapter = chapters.find((c) => c.id === chapterID) ?? chapters[0];
  const versions = chapterPlanVersions(s),
    ready = chapterPlanReady(s) && Boolean(chapter);
  const selected = s.chapterPlans.find((p) => p.chapterId === chapter?.id),
    version = selected?.version ?? 0;
  const jobs = s.chapterPlanJobs.filter((j) => j.input.chapterId === chapter?.id),
    job = jobs.find((j) => j.id === jobID) ?? jobs[0];
  const oldJob = Boolean(
    job &&
    !sameChapterPlanVersions(
      {
        planning: job.input.base.versions,
        outline: job.input.outline.version,
        bindings: job.input.outline.bindingsVersion,
      },
      versions,
    ),
  );
  const oldSelected = Boolean(selected && !sameChapterPlanVersions(selected.versions, versions));
  const running = s.chapterPlanJobs.some((j) => j.status === 'running'),
    busy = generate.isPending || save.isPending;
  const staleEdit = Boolean(
    edit &&
    (rejected ||
      query.isError ||
      !ready ||
      edit.chapterId !== chapter?.id ||
      !sameChapterPlanVersions(edit.expected, versions) ||
      edit.expectedVersion !== version),
  );
  const begin = (source: 'job' | 'saved') => {
    if (!chapter) return;
    const content = source === 'saved' ? selected?.content : job?.output;
    if (!content) return;
    setRejected(false);
    setNotice('');
    setEdit({
      expected: versions,
      chapterId: chapter.id,
      expectedVersion: version,
      sourceVersion: source === 'saved' ? version : 0,
      jobId: (source === 'saved' ? selected?.jobId : job?.id)!,
      candidateVersion: (source === 'saved' ? selected?.candidateVersion : job?.version)!,
      content: structuredClone(content),
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
      {!ready && <p className="core-notice">{t.prerequisite}</p>}
      {query.isError && <p role="alert">{t.error}</p>}
      {notice && <p role="alert">{notice}</p>}
      {chapter && (
        <label>
          {t.chapter}
          <select
            value={chapter.id}
            disabled={Boolean(edit) || busy}
            title={edit ? t.editing : undefined}
            onChange={(e) => {
              setChapterID(e.target.value);
              setJobID('');
              setNotice('');
            }}
          >
            {chapters.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
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
              onClick={() => begin('saved')}
            >
              {t.editSaved}
            </Button>
          </div>
          {oldSelected && <p>{t.oldSelection}</p>}
          <ol className="chapter-plan-summary">
            {selected.content.scenes.map((scene) => (
              <li key={scene.id}>
                <strong>{scene.title}</strong> · {scene.goal}
                <p className="muted">{scene.beats.map((b) => b.title).join(' → ')}</p>
              </li>
            ))}
          </ol>
          <p>
            {t.mustHappen}：{selected.content.brief.mustHappen}
          </p>
          <details>
            <summary>{t.knowledge}</summary>
            <p>{t.knowledgeNote}</p>
            {selected.knowledge.map((k) => {
              const facts = selected.input.base.core.content.worldFacts;
              const names = (ids: string[]) =>
                ids.map((id) => facts.find((f) => f.id === id)?.text ?? id).join('；') || t.noFacts;
              return (
                <div key={k.sceneId}>
                  <h4>{selected.content.scenes.find((c) => c.id === k.sceneId)?.title}</h4>
                  <p>
                    {t.known}：{names(k.knownFactIds)}
                  </p>
                  <p className="muted">
                    {t.excluded}：{names(k.excludedFactIds)}
                  </p>
                </div>
              );
            })}
          </details>
          <p className="muted">{t.handoff}</p>
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
        <Button
          variant="default"
          loading={generate.isPending}
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
                  ? t.placeholder
                  : undefined
          }
          onClick={() =>
            chapter && generate.mutate({ expected: versions, chapterId: chapter.id, request })
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
                {jobs.map((j) => (
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
                {job.output.scenes.map((c) => c.title).join(' / ')} ·{' '}
                {job.output.scenes.flatMap((c) => c.beats).length} {t.beat}
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
                onClick={() => begin('job')}
              >
                {t.candidate}
              </Button>
            </>
          )}
          <details>
            <summary>{t.audit}</summary>
            <p>
              {t.versions}：{Object.values(job.input.base.versions).join(' / ')} /{' '}
              {job.input.outline.version} / {job.input.outline.bindingsVersion}
            </p>
            <p>
              {t.model}：{job.model} · {job.promptVersion} · {job.calls.length} {t.calls}
            </p>
            <p>{t.noPrevious}</p>
            {job.calls.map((c) => (
              <p className="mono" key={c.number}>
                #{c.number} · {c.phase} · {c.elapsedMs} ms
              </p>
            ))}
          </details>
        </Card>
      )}
      {chapter && (
        <PlannedBeatWriting key={chapter.id} chapterId={chapter.id} editing={Boolean(edit)} />
      )}
      {edit && chapter && s.coreSelection && (
        <>
          {staleEdit && <p role="alert">{t.stale}</p>}
          <ChapterPlanEditor
            value={edit}
            chapter={chapter}
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
