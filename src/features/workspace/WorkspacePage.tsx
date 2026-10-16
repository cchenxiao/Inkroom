import { ReconcileDialog } from './components/ReconcileDialog';
import { StreamingCandidate } from './components/StreamingCandidate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import {
  AlignLeft,
  Check,
  CheckCheck,
  Eye,
  Focus,
  Highlighter,
  MessageSquare,
  Sparkles,
  Cloud,
  CloudOff,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBible, useChapter } from '@/shared/api/hooks';
import { ApiError } from '@/shared/api/client';
import { endpoints, queryKeys } from '@/shared/api/endpoints';
import { useUIStore } from '@/shared/lib/ui-store';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
import { AsyncState, Badge, Button, Modal, Textarea, Tooltip } from '@/shared/ui';
import type { ChapterDocument, Finding, RevisionPatch } from '@/types/domain';
import { workspaceApi } from './api';
import { useAutosave } from './use-autosave';
import { SegmentEditor, type SelectedText } from './editor/SegmentEditor';
import { InlineDiff } from './components/InlineDiff';
import { FindingPopover } from './components/FindingPopover';
import { ManuscriptGutter } from './components/ManuscriptGutter';
import { studio } from '@/shared/lib/messages-studio';
import './workspace.css';
export default function WorkspacePage() {
  const chapter = useChapter();
  const branchId = useUIStore((s) => s.branchId);
  return (
    <AsyncState
      loading={chapter.isLoading}
      error={chapter.error}
      onRetry={() => void chapter.refetch()}
    >
      {chapter.data && (
        <Manuscript
          key={`${branchId}:${chapter.data.chapter.id}`}
          document={chapter.data}
          onRefresh={async () => {
            const result = await chapter.refetch();
            return result.data && !result.error ? result.data : null;
          }}
        />
      )}
    </AsyncState>
  );
}
function Manuscript({
  document,
  onRefresh,
}: {
  document: ChapterDocument;
  onRefresh: () => Promise<ChapterDocument | null>;
}) {
  const ui = useUIStore(
      useShallow((state) => ({
        branchId: state.branchId,
        focus: state.focus,
        heatmap: state.heatmap,
        selectFinding: state.selectFinding,
        selectSegment: state.selectSegment,
        selectedFinding: state.selectedFinding,
        selectedSegment: state.selectedSegment,
        setDrawer: state.setDrawer,
        setDrawerTab: state.setDrawerTab,
        setFocus: state.setFocus,
        setHeatmap: state.setHeatmap,
        setPanel: state.setPanel,
        setRun: state.setRun,
        stale: state.stale,
      })),
    ),
    client = useQueryClient(),
    bible = useBible();
  const autosave = useAutosave(document, ui.branchId);
  const [reconcileSnapshot, setReconcileSnapshot] = useState<ChapterDocument | null>(null);
  const stale = ui.stale || autosave.needsReconciliation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'editor' | 'comments' | 'final'>('editor');
  const [selection, setSelection] = useState<SelectedText | null>(null);
  const [instruction, setInstruction] = useState('');
  const [annotationTarget, setAnnotationTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [localPatch, setLocalPatch] = useState<RevisionPatch | null>(null);
  const [structural, setStructural] = useState<Finding | null>(null);
  const [ignoredFinding, setIgnoredFinding] = useState<Finding | null>(null);
  const [ignoreReason, setIgnoreReason] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const selectedFinding = document.findings.find((f) => f.id === ui.selectedFinding);
  const patch =
    localPatch ??
    document.patches.find((p) => p.findingId === ui.selectedFinding && p.status === 'pending');
  const activeIndex = document.segments.findIndex(
    (s) => s.id === (focusedId ?? ui.selectedSegment),
  );
  const long = document.segments.length > 30;
  const virtualizer = useVirtualizer({
    count: document.segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      Math.max(105, Math.ceil(document.segments[index].text.length / 32) * 35 + 36),
    overscan: 5,
    enabled: long,
    scrollMargin: 24,
    rangeExtractor: (range) => {
      const base = defaultRangeExtractor(range);
      return activeIndex < 0 ? base : [...new Set([...base, activeIndex])].sort((a, b) => a - b);
    },
    getItemKey: (i) => document.segments[i].id,
  });
  const findingSegment = selectedFinding?.segmentId;
  const selectSegment = ui.selectSegment;
  const scrolledSelection = useRef<string | null>(null);
  useEffect(() => {
    if (findingSegment) selectSegment(findingSegment);
  }, [findingSegment, selectSegment]);
  useEffect(() => {
    if (scrolledSelection.current === ui.selectedSegment) return;
    scrolledSelection.current = ui.selectedSegment;
    const index = document.segments.findIndex((s) => s.id === ui.selectedSegment);
    if (index < 0) return;
    if (long) virtualizer.scrollToIndex(index, { align: 'start' });
    else
      requestAnimationFrame(() =>
        scrollRef.current
          ?.querySelector(`[data-manuscript-segment="${ui.selectedSegment}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
  }, [ui.selectedSegment, document.segments, long, virtualizer]);
  useEffect(() => {
    setLocalPatch(null);
  }, [ui.selectedFinding, ui.branchId]);
  const execute = useCallback(
    async <T,>(operation: () => Promise<T>, onSuccess?: (result: T) => void) => {
      setBusy(true);
      try {
        const result = await operation();
        onSuccess?.(result);
        void client.invalidateQueries({ queryKey: queryKeys.all });
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          useUIStore.getState().setStale(true);
          void client.invalidateQueries({ queryKey: queryKeys.all });
        }
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [client],
  );
  const version = document.chapter.draftVersion;
  const blocked = stale || autosave.hasPending || autosave.status === 'saving';
  const selectFinding = (id: string) => {
    setLocalPatch(null);
    ui.selectFinding(id);
  };
  const handleSelection = (selected: SelectedText) => {
    if (selected.action === 'bible') {
      ui.setPanel('right', true);
      ui.selectSegment(selected.segmentId);
      return;
    }
    if (blocked) {
      toast.error(stale ? m.stale : m.saveBlocked);
      return;
    }
    if (selected.action === 'lie') {
      const segment = document.segments.find((s) => s.id === selected.segmentId)!;
      void execute(
        () => workspaceApi.saveSegment(segment.id, segment.text, version, ui.branchId, true),
        () => toast.success(m.markedLie),
      );
      return;
    }
    if (selected.action === 'resolve') {
      const segment = document.segments.find((s) => s.id === selected.segmentId);
      const available = bible.data?.foreshadows.filter((f) => f.status === 'open') ?? [];
      if (!available.length) {
        toast.info(m.noOpenForeshadow);
        return;
      }
      setAnnotationTarget(
        (available.find((f) => segment?.foreshadowIds.includes(f.id)) ?? available[0]).id,
      );
    }
    setInstruction(selected.action === 'plant' ? selected.quote.slice(0, 24) : '');
    setSelection(selected);
  };
  const sendComment = () => {
    if (!selection) return;
    if (selection.action === 'plant' || selection.action === 'resolve') {
      const existing = bible.data?.foreshadows.find((f) => f.id === annotationTarget);
      const foreshadow =
        selection.action === 'resolve' && existing
          ? { ...existing, status: 'closed' as const, overdue: false }
          : {
              id: `foreshadow-${crypto.randomUUID()}`,
              title: instruction.trim(),
              plantedChapter: document.chapter.id,
              plantedSegment: selection.segmentId,
              payload: selection.quote,
              planResolveChapter: document.chapter.id,
              status: 'open' as const,
              importance: 'P2' as const,
              overdue: false,
            };
      void execute(
        () => workspaceApi.annotate(foreshadow, selection.quote, version, ui.branchId),
        () => {
          setSelection(null);
          toast.success(m.previewReady);
          ui.setDrawerTab('changes');
          ui.setDrawer('half');
        },
      );
      return;
    }
    if (!instruction.trim()) return;
    void execute(
      () =>
        workspaceApi.comment({
          segmentId: selection.segmentId,
          quote: selection.quote,
          text: instruction.trim(),
          draftVersion: version,
          branchId: ui.branchId,
        }),
      (result) => {
        ui.selectSegment(selection.segmentId);
        setSelection(null);
        if (selection.action === 'instruct') setLocalPatch(result.patch);
        else toast.success(m.selectedComment);
      },
    );
  };
  const applyPatch = (ids: string[]) => {
    if (!patch || blocked) return;
    void execute(
      () =>
        workspaceApi.apply(patch.id, {
          draftVersion: version,
          acceptedSentenceIds: ids,
          branchId: ui.branchId,
        }),
      (result) => {
        client.setQueryData(
          queryKeys.resource(endpoints.chapter(document.chapter.id, ui.branchId)),
          result,
        );
        setLocalPatch(null);
        ui.selectFinding(null);
      },
    );
  };
  const askSuggestion = (finding: Finding) => {
    if (finding.severity === 'P0') {
      setStructural(finding);
      return;
    }
    void execute(() => workspaceApi.suggest(finding.id, version, ui.branchId), setLocalPatch);
  };
  const count = document.segments.reduce(
    (sum, s) => sum + (autosave.drafts[s.id] ?? s.text).replace(/\s/g, '').length,
    0,
  );
  const activeSegment =
    document.segments.find((s) => s.id === ui.selectedSegment) ?? document.segments[0];
  const activeScene =
    document.chapter.scenes.find((s) => s.id === activeSegment?.sceneId) ??
    document.chapter.scenes[0];
  const activeBeat =
    activeScene?.beats.find((b) => b.id === activeSegment?.beatId) ?? activeScene?.beats[0];
  const status = stale ? 'failed' : autosave.status;
  const renderSegment = (index: number) => {
    const segment = document.segments[index];
    const findings = document.findings.filter((f) => f.segmentId === segment.id);
    const showFinding = selectedFinding?.segmentId === segment.id;
    const showPatch = patch?.segmentId === segment.id;
    return (
      <article
        className={`manuscript-segment ${ui.selectedSegment === segment.id ? 'segment-selected' : ''}`}
        data-manuscript-segment={segment.id}
        data-segment-order={index + 1}
        data-beat-title={
          document.chapter.scenes.flatMap((s) => s.beats).find((b) => b.id === segment.beatId)
            ?.title
        }
      >
        <div className="segment-pov">
          <span>{segment.pov}</span>
          {segment.isDialogueLie && <Badge tone="human">{m.lie}</Badge>}
        </div>
        <SegmentEditor
          segment={segment}
          text={autosave.drafts[segment.id] ?? segment.text}
          findings={findings}
          bible={bible.data}
          editable={mode !== 'final' && !stale}
          heatmap={ui.heatmap && mode !== 'final'}
          onChange={autosave.change}
          onFocus={(id) => {
            setFocusedId(id);
            ui.selectSegment(id);
          }}
          onSelection={handleSelection}
          onFinding={selectFinding}
        />
        {mode !== 'final' && <StreamingCandidate segmentId={segment.id} runId={document.run.id} />}
        {mode === 'comments' &&
          segment.comments?.map((comment) => (
            <aside className="manuscript-comment" key={comment.id}>
              <MessageSquare size={13} />
              <div>
                <blockquote>{comment.quote}</blockquote>
                <p>{comment.text}</p>
              </div>
            </aside>
          ))}
        {showFinding && mode !== 'final' && !showPatch && (
          <FindingPopover
            finding={selectedFinding}
            busy={busy}
            disabled={blocked || selectedFinding.draftVersion !== version}
            onClose={() => ui.selectFinding(null)}
            onSuggest={() => askSuggestion(selectedFinding)}
            onIgnore={() => {
              setIgnoreReason('');
              setIgnoredFinding(selectedFinding);
            }}
          />
        )}{' '}
        {showPatch && mode !== 'final' && (
          <InlineDiff
            key={patch.id}
            patch={patch}
            currentVersion={version}
            stale={stale}
            busy={busy || autosave.hasPending}
            onApply={applyPatch}
            onDiscard={() =>
              void execute(
                () => workspaceApi.discard(patch.id, version, ui.branchId),
                () => {
                  setLocalPatch(null);
                  ui.selectFinding(null);
                },
              )
            }
          />
        )}
      </article>
    );
  };
  return (
    <section className={`workspace-center ${mode === 'final' ? 'is-final' : ''}`}>
      {ui.focus && (
        <div className="focus-exit-bar">
          <Button size="sm" variant="ghost" onClick={() => ui.setFocus(false)}>
            {studio.exitFocus}
          </Button>
        </div>
      )}
      <header className="manuscript-toolbar">
        <div
          className="manuscript-context"
          title={`${activeScene?.title ?? ''} · ${activeBeat?.title ?? ''} · ${document.chapter.pov}`}
        >
          <span>{activeBeat?.title ?? activeScene?.title}</span>
          <span>
            {studio.pov} · {document.chapter.pov}
          </span>
          <span className="rhythm-label">{bible.data?.style.tone ?? ''}</span>
        </div>
        <div className="manuscript-tabs" role="tablist" aria-label={m.editor}>
          {(
            [
              ['editor', AlignLeft, m.editor],
              ['comments', MessageSquare, m.comments],
              ['final', CheckCheck, m.final],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
            >
              <Icon size={14} />
              {label}
              {value === 'comments' && document.segments.some((s) => s.comments?.length) ? (
                <span className="tab-count">
                  {document.segments.reduce((n, s) => n + (s.comments?.length ?? 0), 0)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="manuscript-tools">
          <Tooltip content={m.heatmapHint}>
            <button
              className={ui.heatmap ? 'active' : ''}
              aria-pressed={ui.heatmap}
              aria-label={m.heatmap}
              onClick={() => ui.setHeatmap(!ui.heatmap)}
            >
              <Highlighter size={14} />
              <span>{m.heatmap}</span>
            </button>
          </Tooltip>
          <Tooltip content={ui.focus ? m.exitFocus : m.focus}>
            <button
              aria-label={ui.focus ? m.exitFocus : m.focus}
              aria-pressed={ui.focus}
              onClick={() => ui.setFocus(!ui.focus)}
            >
              <Focus size={15} />
            </button>
          </Tooltip>
        </div>
      </header>
      {stale && (
        <div className="manuscript-alert" role="alert">
          <CloudOff size={16} />
          <span>{m.stale}</span>
          <Button
            size="sm"
            onClick={() =>
              void onRefresh().then((loaded) => {
                if (!loaded) return;
                if (autosave.hasPending) setReconcileSnapshot(loaded);
                else autosave.acknowledgeRefresh(loaded.chapter.draftVersion);
              })
            }
          >
            {m.refresh}
          </Button>
        </div>
      )}
      <div className="manuscript-region">
        <div className="manuscript-scroll" ref={scrollRef}>
          <div className="manuscript-page">
            {mode === 'final' && (
              <p className="final-preview-note">
                <Eye size={13} />
                {m.finalHint}
              </p>
            )}
            {long ? (
              <div
                className="virtual-manuscript"
                style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
              >
                {virtualizer.getVirtualItems().map((item) => (
                  <div
                    data-index={item.index}
                    key={item.key}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                    }}
                  >
                    {renderSegment(item.index)}
                  </div>
                ))}
              </div>
            ) : (
              document.segments.map((s, index) => <div key={s.id}>{renderSegment(index)}</div>)
            )}
            {!document.segments.length && (
              <div className="manuscript-empty">
                <Sparkles size={24} />
                <h3>{m.empty}</h3>
                <p>{m.emptyHint}</p>
              </div>
            )}
            {mode === 'comments' && !document.segments.some((s) => s.comments?.length) && (
              <p className="comments-empty">{m.noComments}</p>
            )}
            <footer className="manuscript-end">
              <span />❦<p>{m.end}</p>
            </footer>
          </div>
        </div>
        {mode !== 'final' && (
          <ManuscriptGutter
            scrollRef={scrollRef}
            findings={document.findings}
            onSelect={selectFinding}
            revision={`${mode}:${ui.selectedFinding}:${patch?.id}:${version}`}
          />
        )}
      </div>
      <footer className="manuscript-status">
        <div role="status">
          {status === 'saved' ? (
            <Check size={12} />
          ) : status === 'failed' ? (
            <CloudOff size={12} />
          ) : (
            <Cloud size={12} />
          )}
          <span>{m[status]}</span>
          {(status === 'failed' || status === 'dirty') && !stale && (
            <button onClick={() => void autosave.flush()}>{m.retry}</button>
          )}
        </div>
        <div>
          <span>
            {count.toLocaleString()} / {document.chapter.targetWords.toLocaleString()} {m.words}
          </span>
        </div>
      </footer>
      <ReconcileDialog
        snapshot={reconcileSnapshot}
        drafts={autosave.drafts}
        currentVersion={document.chapter.draftVersion}
        onClose={() => setReconcileSnapshot(null)}
        onConfirm={() => {
          if (
            !reconcileSnapshot ||
            reconcileSnapshot.chapter.draftVersion !== document.chapter.draftVersion
          )
            return;
          if (autosave.reconcileToLatest(reconcileSnapshot.chapter.draftVersion)) {
            setReconcileSnapshot(null);
            void autosave.flush();
          }
        }}
      />
      <Modal
        open={!!selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        title={
          selection?.action === 'plant'
            ? m.plant
            : selection?.action === 'resolve'
              ? m.resolve
              : selection?.action === 'instruct'
                ? m.instructTitle
                : m.commentTitle
        }
        footer={
          <>
            <Button onClick={() => setSelection(null)}>{m.cancel}</Button>
            <Button
              variant="human"
              disabled={
                busy ||
                blocked ||
                (selection?.action === 'resolve' ? !annotationTarget : !instruction.trim())
              }
              onClick={sendComment}
            >
              {selection?.action === 'plant' || selection?.action === 'resolve'
                ? m.previewAnnotation
                : selection?.action === 'instruct'
                  ? m.sendInstruction
                  : m.sendComment}
            </Button>
          </>
        }
      >
        <blockquote className="selection-quote">{selection?.quote}</blockquote>
        {selection?.action === 'resolve' ? (
          <label className="ui-field">
            <span>{m.chooseForeshadow}</span>
            <select
              className="ui-input"
              value={annotationTarget}
              onChange={(e) => setAnnotationTarget(e.target.value)}
            >
              {bible.data?.foreshadows
                .filter((f) => f.status === 'open')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <Textarea
            aria-label={selection?.action === 'plant' ? m.foreshadowTitle : m.commentPlaceholder}
            placeholder={selection?.action === 'plant' ? m.foreshadowTitle : m.commentPlaceholder}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            autoFocus
          />
        )}
      </Modal>
      <Modal
        open={!!ignoredFinding}
        onOpenChange={(open) => {
          if (!open) setIgnoredFinding(null);
        }}
        title={m.ignoreTitle}
        description={m.ignoreDescription}
        footer={
          <>
            <Button onClick={() => setIgnoredFinding(null)}>{m.cancel}</Button>
            <Button
              variant="human"
              disabled={busy || blocked || !ignoreReason.trim()}
              onClick={() => {
                if (ignoredFinding)
                  void execute(
                    () =>
                      workspaceApi.ignore(
                        ignoredFinding.id,
                        version,
                        ui.branchId,
                        ignoreReason.trim(),
                      ),
                    () => {
                      setIgnoredFinding(null);
                      ui.selectFinding(null);
                    },
                  );
              }}
            >
              {m.confirmIgnore}
            </Button>
          </>
        }
      >
        <blockquote className="selection-quote">{ignoredFinding?.quote}</blockquote>
        <Textarea
          aria-label={m.ignoreTitle}
          placeholder={m.ignorePlaceholder}
          value={ignoreReason}
          onChange={(e) => setIgnoreReason(e.target.value)}
          autoFocus
        />
      </Modal>
      <Modal
        open={!!structural}
        onOpenChange={(open) => {
          if (!open) setStructural(null);
        }}
        title={m.structural}
        description={m.structuralHint}
        footer={
          <>
            <Button onClick={() => setStructural(null)}>{m.cancel}</Button>
            <Button
              variant="human"
              disabled={busy || blocked}
              onClick={() => {
                if (structural)
                  void execute(
                    () => workspaceApi.redirect(document.run.id, structural, version, ui.branchId),
                    (run) => {
                      ui.setRun(run.id);
                      ui.setDrawerTab('flow');
                      ui.setDrawer('half');
                      setStructural(null);
                    },
                  );
              }}
            >
              {m.redirect}
            </Button>
          </>
        }
      >
        <div className="structural-impact">
          <Badge tone="danger">P0</Badge>
          <h3>{structural?.reason}</h3>
          <p>{structural?.suggestion}</p>
          <dl>
            <dt>{m.impact}</dt>
            <dd>{structural && m.scopes[structural.repairScope]}</dd>
          </dl>
          {document.chapter.scenes.map((scene) => (
            <p key={scene.id}>
              <ArrowLeft size={12} />
              {scene.title}
            </p>
          ))}
        </div>
      </Modal>
    </section>
  );
}
