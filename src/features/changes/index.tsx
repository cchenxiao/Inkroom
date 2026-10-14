import ChangePreviewDialog from './components/ChangePreviewDialog';
import ConflictCard from './components/ConflictCard';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, GitCompareArrows, MessageSquare, Pencil, Check } from 'lucide-react';
import { useAction, useBible, useChapter, useResource } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import {
  Button,
  Badge,
  Card,
  Modal,
  AsyncState,
  Input,
  Textarea,
  Select,
  PageHeader,
  Field,
} from '@/shared/ui';
import type { ChangeSet, Conflict, RevisionPatch } from '@/types/domain';
import './changes.css';
export default function ChangesPage() {
  const branchId = useUIStore((s) => s.branchId);
  const changes = useResource<ChangeSet[]>(`/changesets?branchId=${branchId}`);
  const conflicts = useResource<Conflict[]>(`/conflicts?branchId=${branchId}`);
  const chapter = useChapter();
  const bible = useBible();
  const navigate = useNavigate();
  const stale = useUIStore((s) => s.stale);
  const [mode, setMode] = useState<number | null>(null);
  const [targetType, setTargetType] = useState('characters');
  const [target, setTarget] = useState('');
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [lie, setLie] = useState(false);
  const [preview, setPreview] = useState<ChangeSet | null>(null);
  const [patchCreated, setPatchCreated] = useState(false);
  const previewAction = useAction<ChangeSet, unknown>('/changesets/preview');
  const inline = useAction<{ changeset: ChangeSet; draftVersion: number }, unknown>(
    `/segments/${target}`,
    'patch',
  );
  const comment = useAction<{ patch: RevisionPatch }, unknown>('/comments');
  const version = chapter.data?.chapter.draftVersion ?? 0;
  const open = (entry: number) => {
    setMode(entry);
    setReason('');
    setContent('');
    setLie(false);
    setTarget(
      entry === 0 ? (bible.data?.characters[0]?.id ?? '') : (chapter.data?.segments[0]?.id ?? ''),
    );
    setTargetType('characters');
    if (entry === 1) setContent(chapter.data?.segments[0]?.text ?? '');
  };
  async function submit() {
    if (mode === 0) {
      const old =
        targetType === 'characters'
          ? bible.data?.characters.find((x) => x.id === target)
          : targetType === 'rules'
            ? bible.data?.rules.find((x) => x.id === target)
            : targetType === 'style'
              ? bible.data?.style
              : undefined;
      const value =
        targetType === 'characters'
          ? { ...old, description: content }
          : targetType === 'rules'
            ? { ...old, rule: content }
            : targetType === 'style'
              ? { ...old, anchorText: content }
              : { description: content };
      setPreview(
        await previewAction.mutateAsync({
          origin: 'human_bible',
          targetType,
          targetId: target,
          new: value,
          reason,
          draftVersion: version,
          branchId,
        }),
      );
    } else if (mode === 1) {
      const result = await inline.mutateAsync({
        text: content,
        draftVersion: version,
        branchId,
        isDialogueLie: lie,
      });
      setPreview(result.changeset);
    } else {
      await comment.mutateAsync({
        segmentId: target,
        quote: chapter.data?.segments.find((s) => s.id === target)?.text ?? '',
        text: reason,
        draftVersion: version,
        branchId,
      });
      setPatchCreated(true);
    }
    setMode(null);
  }
  const jump = (chapterId: string, segmentId: string) => {
    useUIStore.getState().setChapter(chapterId);
    useUIStore.getState().selectSegment(segmentId);
    navigate('/workspace');
  };
  const openConflicts =
    conflicts.data?.filter(
      (c) => c.status === 'open' && (!c.branchId || c.branchId === branchId),
    ) ?? [];
  return (
    <main className="page-content changes-page">
      <PageHeader
        eyebrow={t.changes.eyebrow}
        title={t.changes.title}
        description={t.changes.description}
      />
      <div className="change-entry-grid">
        {[GitCompareArrows, Pencil, MessageSquare].map((Icon, index) => (
          <button
            className="change-entry"
            key={index}
            disabled={!version}
            onClick={() => open(index)}
          >
            <Icon size={20} />
            <h3>{t.changes.entries[index]}</h3>
            <p>{t.changes.entryDescriptions[index]}</p>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      {patchCreated && (
        <Card className="page-row">
          <span>
            <Check size={14} />
            {t.changes.created}
          </span>
          <Button onClick={() => navigate('/workspace')}>{t.changes.openPatch}</Button>
        </Card>
      )}
      <section className="page-section">
        <div className="section-title">
          <h2>{t.changes.conflicts}</h2>
          <Badge tone={openConflicts.length ? 'danger' : 'success'}>{openConflicts.length}</Badge>
        </div>
        <AsyncState
          loading={conflicts.isLoading}
          error={conflicts.error}
          onRetry={() => conflicts.refetch()}
        >
          {openConflicts.length ? (
            openConflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                version={version}
                branchId={branchId}
              />
            ))
          ) : (
            <Card className="quiet">
              <Check size={16} />
              {t.changes.noConflicts}
            </Card>
          )}
        </AsyncState>
      </section>
      <section className="page-section">
        <div className="section-title">
          <h2>{t.changes.blast}</h2>
          <Badge>{changes.data?.length ?? 0}</Badge>
        </div>
        <AsyncState
          loading={changes.isLoading}
          error={changes.error}
          onRetry={() => changes.refetch()}
          empty={!changes.data?.length}
        >
          {changes.data?.map((change) => (
            <Card key={change.id} className="change-record">
              <div className="page-row">
                <div>
                  <small>
                    {new Date(change.createdAt).toLocaleString('zh-CN')} · v{change.draftVersion}
                  </small>
                  <h3>{change.reason}</h3>
                </div>
                <Badge
                  tone={
                    change.status === 'preview'
                      ? 'human'
                      : change.status === 'applied'
                        ? 'success'
                        : 'muted'
                  }
                >
                  {t.changes[change.status]}
                </Badge>
              </div>
              <div className="propagation-steps">
                {t.changes.phases.map((phase, i) => (
                  <div
                    key={phase}
                    className={
                      i < 2 ||
                      (change.status === 'applied' &&
                        ((i === 2 && change.conflicts.every((c) => c.status === 'resolved')) ||
                          (i === 3 && change.blastRadius.every((r) => r.status === 'resolved'))))
                        ? 'complete'
                        : ''
                    }
                  >
                    <span>{i + 1}</span>
                    {phase}
                  </div>
                ))}
              </div>
              <div className="blast-counts">
                {(['rewrite', 'review', 'orphan_foreshadow'] as const).map((level) => (
                  <span key={level}>
                    <strong>{change.blastRadius.filter((r) => r.level === level).length}</strong>
                    {t.changes[level]}
                  </span>
                ))}
              </div>
              {change.blastRadius.map((ref) => (
                <button
                  key={ref.id}
                  className="impact-row"
                  onClick={() => jump(ref.chapterId, ref.segmentId)}
                >
                  <Badge
                    tone={
                      ref.level === 'rewrite'
                        ? 'warning'
                        : ref.level === 'orphan_foreshadow'
                          ? 'foreshadow'
                          : 'info'
                    }
                  >
                    {t.changes[ref.level]}
                  </Badge>
                  <div>
                    <strong>{ref.label}</strong>
                    <p>
                      {ref.chapterId} / {ref.sceneId} / {ref.segmentId} · {ref.reason}
                    </p>
                  </div>
                  <Badge tone={ref.status === 'resolved' ? 'success' : 'muted'}>
                    {ref.status === 'resolved' ? t.common.done : t.common.pending}
                  </Badge>
                  <ArrowUpRight size={14} />
                </button>
              ))}
              <Button variant="ghost" onClick={() => setPreview(change)}>
                {t.common.preview}
                <ArrowUpRight size={13} />
              </Button>
            </Card>
          ))}
        </AsyncState>
      </section>
      <Modal
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
        }}
        title={mode !== null ? t.changes.entries[mode] : t.changes.newChange}
        description={t.common.note}
        footer={
          <Button
            variant="human"
            disabled={
              !target ||
              !reason.trim() ||
              (mode !== 2 && !content.trim()) ||
              previewAction.isPending ||
              inline.isPending ||
              comment.isPending ||
              stale
            }
            disabledReason={stale ? t.common.stale : t.common.required}
            onClick={() => void submit().catch(() => undefined)}
          >
            {mode === 2 ? t.common.suggestion : mode === 1 ? t.common.save : t.common.preview}
          </Button>
        }
      >
        <div className="page-form">
          {mode === 0 ? (
            <>
              <Field label={t.changes.targetType}>
                <Select
                  value={targetType}
                  onChange={(e) => {
                    setTargetType(e.target.value);
                    setTarget(
                      e.target.value === 'characters'
                        ? (bible.data?.characters[0]?.id ?? '')
                        : e.target.value === 'rules'
                          ? (bible.data?.rules[0]?.id ?? '')
                          : e.target.value === 'style'
                            ? (bible.data?.style.id ?? '')
                            : (chapter.data?.chapter.id ?? ''),
                    );
                  }}
                >
                  {(['characters', 'rules', 'style', 'outline'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t.changes[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.changes.target}>
                {['characters', 'rules'].includes(targetType) ? (
                  <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {(targetType === 'characters'
                      ? bible.data?.characters.map((x) => ({ id: x.id, title: x.name }))
                      : bible.data?.rules
                    )?.map((x) => (
                      <option value={x.id} key={x.id}>
                        {x.title}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input value={target} readOnly />
                )}
              </Field>
            </>
          ) : (
            <Field label={t.changes.select}>
              <Select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  if (mode === 1)
                    setContent(
                      chapter.data?.segments.find((s) => s.id === e.target.value)?.text ?? '',
                    );
                }}
              >
                {chapter.data?.segments.map((s, i) => (
                  <option value={s.id} key={s.id}>
                    {i + 1}. {s.text.slice(0, 35)}…
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode !== 2 && (
            <Field label={t.changes.content}>
              <Textarea rows={7} value={content} onChange={(e) => setContent(e.target.value)} />
            </Field>
          )}
          <Field label={t.changes.reason}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {mode === 1 && (
            <label className="check-label">
              <input type="checkbox" checked={lie} onChange={(e) => setLie(e.target.checked)} />
              {t.changes.dialogueLie}
            </label>
          )}
          {(previewAction.error || inline.error || comment.error) && (
            <p role="alert" className="page-error">
              {(previewAction.error ?? inline.error ?? comment.error)?.message}
            </p>
          )}
        </div>
      </Modal>
      <ChangePreviewDialog
        preview={preview}
        onClose={() => setPreview(null)}
        branchId={branchId}
        stale={stale}
        onLocate={jump}
      />
    </main>
  );
}
