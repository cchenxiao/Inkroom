import { workPath, ORIGINAL_PROJECT } from '@/shared/lib/book-context';
import CharacterCard from './components/CharacterCard';
import StyleCard from './components/StyleCard';
import BibleEditDialog, { type Editable } from './components/BibleEditDialog';
import BiblePreviewDialog from './components/BiblePreviewDialog';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Plus, ArrowUpRight } from 'lucide-react';
import { useAction, useBible, useChapter } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import { Button, Badge, Card, AsyncState } from '@/shared/ui';
import type { BibleKind, ChangeSet } from '@/types/domain';
import './pages.css';
import { newBibleEntry } from './draft';
export default function BiblePanel({ compact = true }: { compact?: boolean }) {
  const query = useBible();
  const chapter = useChapter();
  const selectedSegment = useUIStore((s) => s.selectedSegment);
  const relatedCharacters =
    chapter.data?.segments.find((s) => s.id === selectedSegment)?.charactersPresent ?? [];
  const branchId = useUIStore((s) => s.branchId);
  const projectId = useUIStore((s) => s.projectId);
  const goToPlan = () => {
    useUIStore.getState().setPanel('right', false);
    navigate(workPath('prepare', projectId, undefined, kind === 'style' ? 'style' : 'world'));
  };
  const stale = useUIStore((s) => s.stale);
  const navigate = useNavigate();
  const [kind, setKind] = useState<BibleKind>('characters');
  const [editing, setEditing] = useState<Editable | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ChangeSet | null>(null);
  const previewAction = useAction<ChangeSet, unknown>('/changesets/preview');
  const version = chapter.data?.chapter.draftVersion ?? 0;
  const edit = (value: unknown) => {
    if (projectId !== ORIGINAL_PROJECT) {
      goToPlan();
      return;
    }
    setEditing(structuredClone(value) as Editable);
    setReason('');
  };
  const create = () => edit(newBibleEntry(kind, chapter.data?.chapter.id ?? 'ch7'));
  const makePreview = async (value = editing) => {
    if (!value || !reason.trim() || !version) return;
    const result = await previewAction.mutateAsync({
      origin: 'human_bible',
      targetType: kind,
      targetId: value.id ?? kind,
      new: value,
      reason,
      draftVersion: version,
      branchId,
    });
    setPreview(result);
    setEditing(null);
  };
  const toggleLock = async (value: unknown) => {
    if (projectId !== ORIGINAL_PROJECT) {
      goToPlan();
      return;
    }
    const row = value as Editable;
    const result = await previewAction.mutateAsync({
      origin: 'human_bible',
      targetType: kind,
      targetId: row.id,
      new: { ...row, locked: !row.locked },
      reason: row.locked ? t.common.unlock : t.common.lock,
      draftVersion: version,
      branchId,
    });
    setPreview(result);
  };
  return (
    <section className={`bible-panel ${compact ? 'bible-compact' : 'bible-expanded'}`}>
      <div className="bible-heading">
        <div>
          <BookOpen size={15} />
          <strong>{t.bible.title}</strong>
        </div>
        <Badge tone="info">{t.bible.description}</Badge>
      </div>
      <div className="bible-tabs" role="tablist">
        {(Object.keys(t.bible.tabs) as BibleKind[]).map((key) => (
          <button
            role="tab"
            aria-selected={kind === key}
            key={key}
            className={kind === key ? 'is-active' : ''}
            onClick={() => setKind(key)}
          >
            {t.bible.tabs[key]}
          </button>
        ))}
      </div>
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={!query.data}
      >
        {query.data && (
          <div className="bible-content">
            {kind !== 'style' && (
              <div className="bible-tools">
                <span>
                  {t.bible.tabs[kind]} · {(query.data[kind] as unknown[]).length}
                </span>
                <Button variant="ghost" size="sm" onClick={create}>
                  <Plus size={13} />
                  {t.bible.create}
                </Button>
              </div>
            )}
            {kind === 'characters' &&
              query.data.characters.map((c) => (
                <CharacterCard
                  key={c.id}
                  character={c}
                  related={relatedCharacters.includes(c.id)}
                  onEdit={() => edit(c)}
                  onLock={() => void toggleLock(c).catch(() => undefined)}
                />
              ))}
            {kind === 'rules' &&
              query.data.rules.map((rule) => (
                <Card key={rule.id}>
                  <div className="page-row">
                    <h3>{rule.title}</h3>
                    <Badge tone={rule.rigidity === 'hard' ? 'human' : 'muted'}>
                      {rule.rigidity === 'hard' ? t.bible.hard : t.bible.soft}
                    </Badge>
                  </div>
                  <p>{rule.rule}</p>
                  <small>
                    {t.bible.scope} · {rule.scope}
                  </small>
                  <div className="bible-card-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rule.locked}
                      disabledReason={t.common.readOnly}
                      onClick={() => edit(rule)}
                    >
                      {t.common.edit}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void toggleLock(rule).catch(() => undefined)}
                    >
                      {rule.locked ? t.common.unlock : t.common.lock}
                    </Button>
                  </div>
                </Card>
              ))}
            {kind === 'timeline' &&
              query.data.timeline.map((event) => (
                <Card key={event.id}>
                  <small className="page-eyebrow">
                    {event.storyTime} · {event.chapterId}
                  </small>
                  <h3>{event.title}</h3>
                  <p>{event.summary}</p>
                  <p className="quiet">
                    {t.bible.causal} · {event.causalBefore.join(' → ') || '—'}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => edit(event)}>
                    {t.common.edit}
                  </Button>
                </Card>
              ))}
            {kind === 'foreshadows' &&
              query.data.foreshadows.map((item) => (
                <Card key={item.id}>
                  <div className="page-row">
                    <h3>{item.title}</h3>
                    <Badge tone={item.overdue ? 'danger' : 'foreshadow'}>
                      {item.overdue
                        ? t.bible.overdue
                        : item.status === 'open'
                          ? t.bible.planned
                          : item.status === 'closed'
                            ? t.bible.closed
                            : t.bible.abandoned}
                    </Badge>
                  </div>
                  <p>{item.payload}</p>
                  <p className="quiet">
                    {t.bible.planted} {item.plantedChapter} → {t.bible.resolve}{' '}
                    {item.planResolveChapter}
                  </p>
                  <div className="bible-card-actions">
                    <Button size="sm" variant="ghost" onClick={() => edit(item)}>
                      {t.common.edit}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        useUIStore.getState().setChapter(item.plantedChapter);
                        useUIStore.getState().selectSegment(item.plantedSegment);
                        navigate(workPath('workspace', projectId, useUIStore.getState().chapterId));
                      }}
                    >
                      {t.common.locate}
                      <ArrowUpRight size={12} />
                    </Button>
                  </div>
                </Card>
              ))}
            {kind === 'info' &&
              query.data.info.map((item) => (
                <Card key={item.id}>
                  <h3>{item.fact}</h3>
                  <p className="quiet">
                    {t.bible.source} · {item.source}
                  </p>
                  <div className="info-matrix">
                    {Object.entries(item.knownBy).map(([id, known]) => (
                      <div key={id}>
                        <span>{query.data?.characters.find((c) => c.id === id)?.name ?? id}</span>
                        <Badge tone={known ? 'success' : 'muted'}>
                          {known ? t.bible.known : t.bible.unknown}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  <small>{item.disclosedChapter}</small>
                  <Button variant="ghost" size="sm" onClick={() => edit(item)}>
                    {t.common.edit}
                  </Button>
                </Card>
              ))}
            {kind === 'style' && (
              <StyleCard
                style={query.data.style}
                onEdit={() => edit(query.data?.style)}
                onLock={() => void toggleLock(query.data?.style).catch(() => undefined)}
              />
            )}
          </div>
        )}
      </AsyncState>
      <BibleEditDialog
        editing={editing}
        setEditing={setEditing}
        kind={kind}
        reason={reason}
        setReason={setReason}
        pending={previewAction.isPending}
        error={previewAction.error}
        version={version}
        stale={stale}
        onPreview={makePreview}
      />
      <BiblePreviewDialog
        preview={preview}
        onClose={() => setPreview(null)}
        branchId={branchId}
        stale={stale}
      />
    </section>
  );
}
