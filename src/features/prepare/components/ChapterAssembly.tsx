import { useState } from 'react';
import ChapterReview from './ChapterReview';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { Badge, Button, Card } from '@/shared/ui';
import { assemblyMessages as t } from '@/shared/lib/messages-assembly';
import { assemblyApi, type AssemblySaveRequest, type AssemblyPart } from '../api/chapter-assembly';

function Manuscript({ parts }: { parts: AssemblyPart[] }) {
  return (
    <div className="backend-candidate">
      {parts.flatMap((part) =>
        part.segments.map((s) => (
          <p
            key={`${part.beatId}:${s.id}`}
            title={`${part.sceneTitle} · ${part.beatTitle} · v${part.draftVersion}`}
          >
            {s.text}
          </p>
        )),
      )}
    </div>
  );
}
export default function ChapterAssembly({
  chapterId,
  editing,
}: {
  chapterId: string;
  editing: boolean;
}) {
  const client = useQueryClient();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState('');
  const [uncertain, setUncertain] = useState<AssemblySaveRequest | null>(null);
  const [stale, setStale] = useState(false);
  const query = useQuery({
    queryKey: ['chapter-assembly', chapterId, choices],
    queryFn: () => assemblyApi.preview(chapterId, choices),
    retry: false,
    refetchInterval: 5000,
  });
  const refresh = () => {
    setConfirmed('');
    void client.invalidateQueries({ queryKey: ['chapter-assembly', chapterId] });
  };
  const save = useMutation({
    mutationFn: assemblyApi.save,
    retry: false,
    onSuccess: () => {
      setUncertain(null);
      setStale(false);
      refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        setUncertain(null);
        setConfirmed('');
        setStale(error.status === 409);
        refresh();
      }
    },
  });
  const data = query.data;
  const block = editing
    ? t.editing
    : query.isError
      ? t.error
      : !data?.ready
        ? data?.reason || t.loading
        : '';
  const locked = save.isPending || !!uncertain;
  return (
    <Card className="core-workbench" aria-label={t.title}>
      <div className="core-heading">
        <h3>{t.title}</h3>
        <Button size="sm" disabled={locked} onClick={refresh}>
          {t.refresh}
        </Button>
      </div>
      <p className="muted">{t.note}</p>
      {query.isPending && <p role="status">{t.loading}</p>}
      {query.isError && <p role="alert">{t.error}</p>}
      {data && (
        <>
          <p>
            {data.slots.filter((s) => !s.reason).length}/{data.slots.length} {t.complete}
          </p>
          {data.slots.map((slot) => (
            <div key={slot.part.beatId} className="core-field">
              <label>
                {slot.part.sceneTitle} · {slot.part.beatTitle}
                <select
                  value={choices[slot.part.beatId] ?? slot.part.commitId}
                  disabled={locked || editing}
                  onChange={(e) => {
                    setConfirmed('');
                    setChoices({ ...choices, [slot.part.beatId]: e.target.value });
                    save.reset();
                  }}
                >
                  <option value="">{t.missing}</option>
                  {slot.choices.map((c) => (
                    <option key={c.commitId} value={c.commitId} disabled={!c.eligible}>
                      v{c.draftVersion} · {new Date(c.createdAt).toLocaleString('zh-CN')} ·{' '}
                      {c.commitId.slice(0, 8)}
                      {c.reason ? ` · ${c.reason}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {slot.reason && <p>{slot.reason}</p>}
            </div>
          ))}
          {!!data.draft.parts?.length && (
            <details open>
              <summary>{t.preview}</summary>
              <Manuscript parts={data.draft.parts} />
            </details>
          )}
          {block && <p>{block}</p>}
          <label className="outline-check">
            <input
              type="checkbox"
              checked={!!confirmed && confirmed === data.previewDigest}
              disabled={!!block || locked || query.isFetching}
              onChange={(e) => {
                setStale(false);
                setConfirmed(e.target.checked ? data.previewDigest : '');
              }}
            />
            {t.confirm}
          </label>
          <Button
            variant="human"
            loading={save.isPending}
            disabled={
              !!block ||
              locked ||
              query.isFetching ||
              !confirmed ||
              confirmed !== data.previewDigest
            }
            disabledReason={block || (uncertain ? t.uncertain : t.needsConfirm)}
            onClick={() => {
              const req: AssemblySaveRequest = {
                requestId: crypto.randomUUID(),
                chapterId,
                choices: Object.fromEntries(data.draft.parts.map((p) => [p.beatId, p.commitId])),
                expectedVersion: data.expectedVersion,
                previewDigest: data.previewDigest,
                confirm: true,
              };
              setUncertain(req);
              save.mutate(req);
            }}
          >
            {t.save}
          </Button>
          {save.isSuccess && (
            <p role="status">
              {t.saved} · v{save.data.version}
            </p>
          )}
          {stale && <p role="alert">{t.stale}</p>}
          {save.isError && !stale && (
            <p role="alert">{save.error instanceof ApiError ? save.error.message : t.uncertain}</p>
          )}
          {uncertain && !save.isPending && (
            <>
              <p role="alert">{t.uncertain}</p>
              <Button onClick={() => save.mutate(uncertain)}>{t.retry}</Button>
            </>
          )}
          <details>
            <summary>
              {t.history} · {data.history.length}
            </summary>
            {!data.history.length && <p>{t.noHistory}</p>}
            {data.history.map((a) => (
              <details key={a.id}>
                <summary>
                  v{a.version} · {new Date(a.createdAt).toLocaleString('zh-CN')} · {t.pending}
                </summary>
                <p>{t.historical}</p>
                <Badge>
                  {t.plan} v{a.planVersion} · {t.knowledge} v{a.knowledge.version}
                </Badge>
                <Manuscript parts={a.parts} />
                {a.parts.map((part) => (
                  <p key={part.beatId}>
                    {part.beatTitle} · {t.source} {part.commitId} · v{part.draftVersion}
                  </p>
                ))}
              </details>
            ))}
          </details>
          <ChapterReview assemblies={data.history} editing={editing} />
        </>
      )}
    </Card>
  );
}
