import { readableMessage } from '@/shared/lib/business-labels';
import type { SelectedText } from '@/features/workspace/editor/SegmentEditor';
import type { ManuscriptInspection } from '@/types/domain/manuscript-view';
import { usePanelDialog } from '@/shared/lib/use-panel-dialog';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Command,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  ShieldCheck,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { PendingWritingProvider, useWritingLocked } from '@/shared/lib/pending-writing';
import { useUIStore } from '@/shared/lib/ui-store';
import { livePreparePath, liveWorkspacePath } from '@/shared/lib/writing-mode';
import { writingDesk as t } from '@/shared/lib/messages-writing-desk';
import { AsyncState, Badge, Button, Modal, DangerButton } from '@/shared/ui';
import {
  usePlanning,
  usePlannedWriting,
  useChapterCandidates,
  useWritingActions,
  chapterPlanReady,
  chapterPlanVersions,
  sameChapterPlanVersions,
  assemblyApi,
  ChapterAssembly,
  type PlanningState,
} from '@/features/prepare/writing';
import { WritingManuscript, type ManuscriptPart } from '@/features/workspace';
import type { Segment, Finding } from '@/types/domain';
import { ErrorBoundary } from '../error-boundary';
import { NavRail } from '../components/nav-rail';
import { WritingBible, WritingGate, WritingFinding } from './writing-panels';
import { WritingDrawer } from './writing-drawer';
import { useAuthorDraft } from './author-draft';
import './writing.css';
import { RevisionReceipt } from './revision-receipt';
import { rewriteRequest } from './rewrite-request';

type Panel = 'review' | 'bible' | 'assembly' | null;
const panelFrom = (query: URLSearchParams): Panel => {
  const panel = query.get('panel');
  if (panel === 'closed') return null;
  if (panel === 'review' || panel === 'bible' || panel === 'assembly') return panel;
  return query.get('stage') === 'assembly' ? 'assembly' : null;
};

export default function WritingWorkspace() {
  return (
    <PendingWritingProvider>
      <ErrorBoundary>
        <PlanningDesk />
      </ErrorBoundary>
    </PendingWritingProvider>
  );
}
function PlanningDesk() {
  const planning = usePlanning();
  const [params] = useSearchParams();
  const requested = params.get('planningChapterId');
  const chapter =
    planning.data?.outlineSelection?.content.chapters.find((c) => c.id === requested) ??
    (!requested ? planning.data?.outlineSelection?.content.chapters[0] : undefined);
  return (
    <AsyncState
      loading={!planning.data && planning.isPending}
      error={!planning.data ? planning.error : null}
      onRetry={() => void planning.refetch()}
    >
      {planning.data && (
        <Desk
          key={chapter?.id ?? 'empty'}
          planning={planning.data}
          chapterId={chapter?.id ?? ''}
          planningError={planning.isError}
          refreshPlanning={() => void planning.refetch()}
        />
      )}
    </AsyncState>
  );
}
function Desk({
  planning,
  chapterId,
  planningError,
  refreshPlanning,
}: {
  planning: PlanningState;
  chapterId: string;
  planningError: boolean;
  refreshPlanning: () => void;
}) {
  const navigate = useNavigate(),
    [params, setParams] = useSearchParams();
  const chapters = planning.outlineSelection?.content.chapters ?? [];
  const chapter = chapters.find((c) => c.id === chapterId);
  const plan = planning.chapterPlans?.find((p) => p.chapterId === chapterId);
  const requestedBeat = params.get('beatId');
  const beatId =
    (plan?.content.scenes.some((s) => s.beats.some((b) => b.id === requestedBeat))
      ? requestedBeat
      : null) ||
    plan?.content.brief.selectedBeatId ||
    '';
  const scene = plan?.content.scenes.find((s) => s.beats.some((b) => b.id === beatId));
  const beat = scene?.beats.find((b) => b.id === beatId);
  const ready =
    !!chapter &&
    chapter.id === chapters[0]?.id &&
    chapterPlanReady(planning) &&
    !!plan?.confirmed &&
    sameChapterPlanVersions(plan.versions, chapterPlanVersions(planning));
  const writer = usePlannedWriting(chapterId, beatId, !ready || planningError);
  const chapterBeats = plan?.content.scenes.flatMap((scene) => scene.beats) ?? [];
  const candidates = useChapterCandidates(
    chapterId,
    chapterBeats.map((beat) => beat.id),
  );
  const run = writer.run;
  const currentVersion =
    writer.draft.isError || writer.runQuery.isError || planningError
      ? undefined
      : writer.draft.data?.draftVersion;
  const actions = useWritingActions(run, currentVersion);
  const draft = useAuthorDraft(run?.id, run?.draftVersion);
  const [pendingSelection, setPendingSelection] = useState<
    (SelectedText & { beatId: string }) | null
  >(null);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ManuscriptInspection | null>(null);
  const inspect = (view: ManuscriptInspection) => {
    if (draft.dirty) return;
    setInspection(view);
    setSelectedFinding(view.selectedFinding ?? null);
  };
  const side = panelFrom(params);
  const setSide = useCallback(
    (value: Panel | ((previous: Panel) => Panel)) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          const panel = typeof value === 'function' ? value(panelFrom(current)) : value;
          next.set('panel', panel ?? 'closed');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const instructionDraft = useAuthorDraft(
    run ? 'instruction:' + run.id : undefined,
    run?.draftVersion,
  );
  const instruction = instructionDraft.texts.instruction ?? '';
  const quote = instructionDraft.texts.quote;
  const selection = useMemo(() => (quote ? { quote } : null), [quote]);
  const setInstruction = (text: string) =>
    text ? instructionDraft.change('instruction', text) : instructionDraft.remove('instruction');
  const acknowledged = actions.mutation.isSuccess ? actions.mutation.variables : undefined;
  useEffect(() => {
    if (!acknowledged || acknowledged.runId !== run?.id || acknowledged.operation.kind !== 'action')
      return;
    const action = acknowledged.operation.input;
    if (
      action.type === 'inline_edit' &&
      action.segmentId &&
      draft.texts[action.segmentId] === action.text
    )
      draft.remove(action.segmentId);
    if (
      (action.type === 'instruct' || action.type === 'rewrite') &&
      instructionDraft.dirty &&
      (action.type === 'rewrite'
        ? action.rewrite?.instruction === instruction
        : action.instruction ===
          (selection ? '针对「' + selection.quote + '」：' : '') + instruction)
    )
      instructionDraft.clear();
  }, [acknowledged, run?.id, draft, instructionDraft, selection, instruction]);
  const [confirmed, setConfirmed] = useState('');
  const [compact, setCompact] = useState(window.innerWidth < 1200);
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 1200);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [command, setCommand] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const focus = useUIStore((s) => s.focus),
    leftOpen = useUIStore((s) => s.leftOpen);
  const locked = useWritingLocked();
  const reviewPanel = useRef<HTMLElement>(null);
  usePanelDialog(reviewPanel, compact && !focus && !!side, () => setSide(null));
  useEffect(() => {
    if (
      !chapterId ||
      !beatId ||
      (params.get('planningChapterId') === chapterId && params.get('beatId') === beatId)
    )
      return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('planningChapterId', chapterId);
        next.set('beatId', beatId);
        return next;
      },
      { replace: true },
    );
  }, [chapterId, beatId, params, setParams]);
  useEffect(() => {
    setSelectedFinding(null);
    setConfirmed('');
  }, [beatId]);
  const assembly = useQuery({
    queryKey: ['chapter-assembly', chapterId, {}],
    queryFn: () => assemblyApi.preview(chapterId, {}),
    enabled: !!chapterId && ready,
    retry: false,
    refetchInterval: 5000,
  });
  const busy = actions.busy || writer.start.isPending || !!writer.pendingStart;
  const block = !chapter
    ? t.prerequisite
    : chapter.id !== chapters[0]?.id
      ? t.laterChapter
      : !ready
        ? t.prerequisite
        : (writer.block ?? '');
  const stale =
    draft.stale ||
    run?.status === 'stale' ||
    (!!run && currentVersion !== undefined && currentVersion !== run.draftVersion);
  const editable = actions.waiting && !busy && !stale;
  const sourceSegments = (run?.result?.segments ?? []).map((segment) =>
    run?.pendingAction?.type === 'inline_edit' && run.pendingAction.segmentId === segment.id
      ? { ...segment, text: run.pendingAction.text ?? segment.text }
      : segment,
  );
  const findings: Finding[] = (run?.result?.report.findings ?? []).map((f) => ({
    ...f,
    draftVersion: run!.draftVersion,
    status: 'open',
    replacement: '',
  }));
  let order = 0;
  const parts: ManuscriptPart[] =
    plan?.content.scenes.flatMap((s) =>
      s.beats.map((b) => {
        const stored = assembly.data?.draft.parts.find((p) => p.beatId === b.id);
        const candidateQuery = candidates[chapterBeats.findIndex((beat) => beat.id === b.id)];
        const working = candidateQuery?.data?.working;
        const candidate = candidateQuery?.data?.runs.find(
          (candidate) => candidate.result?.segments.length,
        );
        const current = !!run && (b.id === beatId || run.planning?.mode === 'chapter');
        const allTexts =
          current && sourceSegments.length
            ? sourceSegments
            : (working?.segments ?? candidate?.result?.segments ?? stored?.segments ?? []);
        const texts = allTexts.filter((segment) => !segment.beatId || segment.beatId === b.id);
        const segments: Segment[] = texts.map((text) => ({
          id: text.id,
          text: text.text,
          version: text.version,
          chapterId,
          sceneId: s.id,
          beatId: b.id,
          order: ++order,
          pov:
            planning.coreSelection?.content.characters.find((c) => c.id === s.povCharacterId)
              ?.name ?? '',
          charactersPresent: s.characterIds,
          entitiesMentioned: [],
          foreshadowIds: [],
          styleStats: {
            sentenceLengths:
              run?.result?.metrics.find((m) => m.segmentId === text.id)?.sentenceLengths ?? [],
            dialogueRatio: 0,
            aiTaste: 0,
            repeatedPhrases: [],
          },
        }));
        return {
          id: b.id,
          title: b.title,
          segments,
          accepted:
            current && sourceSegments.length
              ? !!run.commitId
              : working
                ? working.state === 'adopted'
                : candidate
                  ? !!candidate.commitId
                  : !!stored?.commitId,
          loading: !texts.length && candidateQuery?.isPending,
          loadError: !texts.length && candidateQuery?.isError,
          onRetry: () => {
            void candidateQuery?.refetch();
          },
        };
      }),
    ) ?? [];
  const selectBeat = (id: string) => {
    if (locked || busy) return;
    setInspection(null);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('beatId', id);
        return next;
      },
      { replace: true },
    );
  };
  const inspectedParts: ManuscriptPart[] | undefined = inspection?.parts.map((part, i) => ({
    id: part.id,
    title: part.title,
    accepted: true,
    segments: part.segments.map((segment, j) => ({
      ...segment,
      chapterId,
      sceneId: '',
      beatId: part.id,
      order: i + j + 1,
      pov: planning.styleSelection?.rules.pov ?? '',
      charactersPresent: [],
      entitiesMentioned: [],
      foreshadowIds: [],
      styleStats: { sentenceLengths: [], dialogueRatio: 0, aiTaste: 0, repeatedPhrases: [] },
    })),
  }));
  const selectFinding = (id: string) => {
    setSelectedFinding(id);
  };
  const showReview = (targetBeat?: string) => {
    if (targetBeat && targetBeat !== beatId && (locked || busy)) return;
    setInspection(null);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (targetBeat) next.set('beatId', targetBeat);
        next.set('panel', 'review');
        return next;
      },
      { replace: true },
    );
  };
  const selectText = (value: SelectedText) => {
    if (value.action === 'bible') {
      setSide('bible');
      return;
    }
    if (inspection) {
      setSide('assembly');
      setSelectionNotice('正在核对冻结的章稿。请先回到正文，再选择对应情节段修改或重写。');
      return;
    }
    const part = parts.find((p) => p.segments.some((segment) => segment.id === value.segmentId));
    if (!part) return;
    if (part.id !== beatId && (locked || busy)) {
      setSelectionNotice('请先保存或放弃当前修改，再处理另一段正文。');
      return;
    }
    setPendingSelection({ ...value, beatId: part.id });
    showReview(part.id);
  };
  useEffect(() => {
    if (!pendingSelection || pendingSelection.beatId !== beatId || !run) return;
    const segment = sourceSegments.find((s) => s.id === pendingSelection.segmentId);
    if (writer.runQuery.isFetching) return;
    setPendingSelection(null);
    if (!segment) {
      setSelectionNotice('所选正文不属于当前候选，请核对候选历史后重新选择。');
      return;
    }
    if (
      (pendingSelection.version !== undefined && segment.version !== pendingSelection.version) ||
      (pendingSelection.quote && !segment.text.includes(pendingSelection.quote))
    ) {
      setSelectionNotice('原文版本已变化，请在当前正文重新选择，避免修改错误位置。');
      return;
    }
    if (pendingSelection.action === 'review') {
      setSelectionNotice('');
      return;
    }
    if (
      (pendingSelection.action === 'edit' ? !editable : busy || run.status === 'running') ||
      instructionDraft.stale
    ) {
      setSelectionNotice(
        run.commitId
          ? '这是已采用稿。原稿保留；请用下方「重新生成本段」建立新候选，再修改、审核和采用。'
          : '当前稿暂不可修改。请先处理版本或运行状态，再选择正文。',
      );
      return;
    }
    if (draft.dirty && pendingSelection.action !== 'edit') {
      setSelectionNotice('请先保存并复检正文，再发送修改要求。');
      return;
    }
    setSelectionNotice('');
    if (pendingSelection.action === 'edit') {
      document
        .querySelector<HTMLElement>(`[data-testid="editor-${CSS.escape(segment.id)}"]`)
        ?.focus();
      return;
    }
    instructionDraft.change('segmentId', segment.id);
    if (pendingSelection.quote) instructionDraft.change('quote', pendingSelection.quote);
    else instructionDraft.remove('quote');
    if (pendingSelection.action === 'rewrite')
      instructionDraft.change(
        'instruction',
        pendingSelection.quote
          ? '请重写选中的内容，保留已确认事实、人物知情范围与前后衔接；不改动选区之外的正文。'
          : '请重写本段，保留已确认事实、人物知情范围与当前情节目标。',
      );
    document.querySelector<HTMLTextAreaElement>('[data-writing-instruction]')?.focus();
  }, [
    pendingSelection,
    beatId,
    run,
    sourceSegments,
    writer.runQuery.isFetching,
    editable,
    busy,
    instructionDraft,
    draft.dirty,
  ]);
  const autoOpened = useRef('');
  useEffect(() => {
    const key = `${run?.id}:${run?.draftVersion}`;
    if (run?.status === 'waiting_human' && autoOpened.current !== key) {
      autoOpened.current = key;
      setSide((current) => current ?? 'review');
    }
  }, [run?.id, run?.draftVersion, run?.status, setSide]);
  const saveEdit = async () => {
    const entry = Object.entries(draft.texts)[0];
    if (!entry || !editable || draft.stale) return;
    if (await actions.edit(entry[0], entry[1])) draft.remove(entry[0]);
  };
  const startDisabled =
    !!block || !writer.gate.data?.ready || locked || busy || run?.status === 'running';
  const start = () => {
    if (startDisabled) return;
    if ((writer.gate.data?.draftVersion ?? 0) > 0 && !regenerate) {
      setRegenerate(true);
      return;
    }
    writer.begin();
  };
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSide((v) => (v === 'bible' ? null : 'bible'));
      }
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) {
        useUIStore.getState().setFocus(false);
        setSide(null);
        setSelectedFinding(null);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [setSide]);
  const reason = stale
    ? t.stale
    : planningError
      ? '暂时无法读取真实规划，请确认 Go 服务已启动。'
      : block ||
        (run?.error ? readableMessage(run.error, '本次修改或复检未完成，请检查结果后重试。') : '');
  const canRewrite = !!run?.result && !busy && run.status !== 'running' && !draft.dirty;
  const sendRewrite = async () => {
    const segment =
      sourceSegments.find((s) => s.id === instructionDraft.texts.segmentId) ??
      sourceSegments.find((s) => !s.beatId || s.beatId === beatId);
    if (!segment || !canRewrite) return;
    try {
      const request = rewriteRequest(segment, instruction, quote);
      // Legacy runs did not freeze neighboring prose; fork them with current context.
      const inPlace =
        actions.waiting &&
        (run?.planning?.neighborPolicy === 'working-v1' || run?.planning?.mode === 'chapter');
      if (await (inPlace ? actions.rewrite(request) : writer.revise(request)))
        instructionDraft.clear();
    } catch (error) {
      setSelectionNotice(error instanceof Error ? error.message : '无法定位选区，请重新选择。');
    }
  };
  const primaryLabel =
    run?.status === 'running'
      ? t.running
      : run?.status === 'committed'
        ? t.assembly
        : run
          ? t.review
          : '生成整章';
  const primary = () => {
    if (run?.status === 'committed') setSide('assembly');
    else if (run) showReview();
    else writer.beginChapter();
  };
  const tree = (
    <aside className="chapter-sidebar" aria-label={t.allChapters}>
      <header className="sidebar-heading">
        <strong>{t.structure}</strong>
        <Button
          size="icon"
          variant="ghost"
          aria-label="收起结构"
          onClick={() => {
            useUIStore.getState().setPanel('left', false);
          }}
        >
          <PanelLeftClose size={16} />
        </Button>
      </header>
      <div className="chapter-scroll">
        {chapters.map((c, i) => (
          <div className="chapter-group" key={c.id}>
            <Link
              className={`chapter-row ${c.id === chapterId ? 'active' : ''}`}
              to={liveWorkspacePath(c.id)}
            >
              <BookOpen size={14} />
              <span>
                第 {i + 1} 章 · {c.title}
              </span>
            </Link>
            {c.id === chapterId &&
              plan?.content.scenes.map((s) => (
                <div key={s.id}>
                  <div className="writing-tree-scene">{s.title}</div>
                  {s.beats.map((b) => {
                    const part = parts.find((p) => p.id === b.id);
                    return (
                      <button
                        className="writing-tree-beat"
                        key={b.id}
                        aria-current={beatId === b.id}
                        disabled={locked || busy}
                        onClick={() => selectBeat(b.id)}
                      >
                        {part?.accepted ? <Check size={13} /> : <Circle size={10} />}
                        <span>{b.title}</span>
                        <small>{b.id === beatId ? findings.length || '' : ''}</small>
                      </button>
                    );
                  })}
                </div>
              ))}
          </div>
        ))}
      </div>
      <footer className="writing-sidebar-footer">
        <span>
          {parts.filter((p) => p.accepted).length}/{parts.length} 段已采用 · 目标{' '}
          {chapter?.targetWords?.toLocaleString() ?? '—'} 字
        </span>
        <Link to={livePreparePath('outline', chapterId)}>{t.prepare} →</Link>
      </footer>
    </aside>
  );
  return (
    <div className={`app-shell writing-shell ${focus ? 'focus-mode' : ''}`}>
      <NavRail realWriting />
      <div className="app-main">
        <div className="shell-top">
          <header className="top-bar">
            <div className="book-identity">
              <Link className="book-name" to="/book/project-zhuoliu">
                {t.book}
              </Link>
              <span className="top-divider" />
              <GitBranch size={13} />
              <span>{t.branch}</span>
            </div>
            <div className="chapter-breadcrumb">
              <span>
                {chapter ? `第 ${chapters.indexOf(chapter) + 1} 章 · ${chapter.title}` : '创作准备'}
              </span>
              {run && (
                <>
                  <Badge>v{run.draftVersion}</Badge>
                  <Badge>{t.statuses[run.status]}</Badge>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="上一章"
                disabled={!chapter || chapters.indexOf(chapter) === 0}
                onClick={() =>
                  chapter && navigate(liveWorkspacePath(chapters[chapters.indexOf(chapter) - 1].id))
                }
              >
                <ChevronLeft size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="下一章"
                disabled={!chapter || chapters.indexOf(chapter) === chapters.length - 1}
                onClick={() =>
                  chapter && navigate(liveWorkspacePath(chapters[chapters.indexOf(chapter) + 1].id))
                }
              >
                <ChevronRight size={14} />
              </Button>
            </div>
            <div className="top-actions">
              <Button
                variant="ghost"
                size="icon"
                aria-label="刷新规划"
                onClick={() => {
                  refreshPlanning();
                  writer.refresh();
                }}
              >
                <RefreshCw size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.command}
                onClick={() => setCommand(true)}
              >
                <Command size={14} />
                <kbd>K</kbd>
              </Button>
              <Button
                size="sm"
                variant={run && run.status !== 'running' ? 'human' : 'default'}
                disabled={
                  run?.status === 'running' ||
                  (!run && (locked || busy || !!block || !writer.chapterGate.data?.ready))
                }
                disabledReason={run?.status === 'running' ? t.pauseUnavailable : block}
                onClick={primary}
              >
                <Play size={13} />
                {primaryLabel}
              </Button>
            </div>
          </header>
        </div>
        <div className={`main-body workspace-body ${side ? 'has-review' : ''}`}>
          {!focus &&
            (leftOpen ? (
              tree
            ) : (
              <aside className="structure-rail">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="展开结构"
                  onClick={() => {
                    useUIStore.getState().setPanel('left', true);
                  }}
                >
                  <PanelLeftOpen size={17} />
                </Button>
                <span>{t.structure}</span>
              </aside>
            ))}
          <main className="route-content">
            {selectionNotice && (
              <div className="manuscript-alert" role="status">
                <span>{selectionNotice}</span>
                <Button size="sm" variant="ghost" onClick={() => setSelectionNotice('')}>
                  知道了
                </Button>
              </div>
            )}
            {inspection && (
              <div className="manuscript-alert inspection-banner">
                <span>{inspection.title} · 只读来源快照</span>
                <Button
                  size="sm"
                  onClick={() => {
                    setInspection(null);
                    setSelectedFinding(null);
                  }}
                >
                  {t.returnWriting}
                </Button>
              </div>
            )}
            {plan ? (
              <WritingManuscript
                parts={inspectedParts ?? parts}
                activeBeat={inspection ? '' : beatId}
                title={inspection?.title ?? beat?.title ?? chapter?.title ?? ''}
                pov={planning.styleSelection?.rules.pov ?? ''}
                tone={planning.styleSelection?.rules.tone}
                findings={inspection?.findings ?? findings}
                selectedFinding={selectedFinding}
                editable={editable && !inspection}
                localText={draft.texts}
                dirty={draft.dirty}
                blocked={reason}
                busy={busy || run?.status === 'running'}
                onChange={draft.change}
                onSelectBeat={selectBeat}
                onFinding={selectFinding}
                onSelection={selectText}
                onRewrite={(id) => {
                  const segment = parts.find((part) => part.id === id)?.segments[0];
                  if (segment)
                    selectText({
                      segmentId: segment.id,
                      version: segment.version,
                      quote: '',
                      action: 'rewrite',
                    });
                }}
                onSave={() => void saveEdit()}
                onStart={start}
                onReview={showReview}
                startDisabled={startDisabled}
              >
                {selectedFinding && !inspection && (
                  <WritingFinding
                    run={run}
                    id={selectedFinding}
                    onClose={() => setSelectedFinding(null)}
                    onEdit={() => {
                      setSelectedFinding(null);
                      showReview();
                    }}
                    onInstruct={() => {
                      setInstruction(
                        run?.result?.report.findings.find((f) => f.id === selectedFinding)
                          ?.suggestion ?? '',
                      );
                      showReview();
                    }}
                  />
                )}
              </WritingManuscript>
            ) : (
              <div className="writing-empty">
                <h2>{chapter?.title ?? '尚未准备章节'}</h2>
                <p>{block || t.prerequisite}</p>
                <Link to={livePreparePath('outline', chapterId)}>{t.prepare}</Link>
              </div>
            )}
          </main>
          {compact && !focus && !!side && (
            <button
              type="button"
              tabIndex={-1}
              data-panel-backdrop
              aria-label="关闭审核抽屉"
              className="writing-review-backdrop"
              onClick={() => setSide(null)}
            />
          )}
          <aside
            ref={reviewPanel}
            tabIndex={-1}
            aria-modal={compact && !focus && !!side ? true : undefined}
            className="workspace-review"
            role={compact ? 'dialog' : 'complementary'}
            aria-label="正文旁审核"
            hidden={focus || !side}
          >
            <h2 className="sr-only">正文旁审核</h2>
            <header className="workspace-review-heading">
              <div role="tablist" aria-label="作者工作面板">
                {(
                  [
                    ['review', t.review],
                    ['assembly', t.assembly],
                    ['bible', t.knowledge],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    role="tab"
                    aria-selected={side === id}
                    key={id}
                    onClick={() => setSide(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t.close}
                onClick={() => setSide(null)}
              >
                <X size={16} />
              </Button>
            </header>
            <div className="writing-panel-scroll" hidden={side !== 'bible'}>
              <WritingBible planning={planning} chapterId={chapterId} />
            </div>
            <div className="writing-panel-scroll" hidden={side !== 'assembly'}>
              {!!chapterId && (
                <ChapterAssembly
                  chapterId={chapterId}
                  editing={!ready || draft.dirty || planningError}
                  embedded
                  onRead={inspect}
                  onReviewBeat={showReview}
                />
              )}
            </div>
            <div className="writing-panel-scroll writing-review-scroll" hidden={side !== 'review'}>
              <section className="writing-next-step" aria-label="当前稿与下一步" aria-live="polite">
                <strong>
                  {run?.planning?.mode === 'chapter' ? chapter?.title : beat?.title || '当前情节段'}
                  {run ? ` · v${run.draftVersion}` : ''}
                </strong>
                <p>
                  {run?.status === 'running'
                    ? '正在生成或复检正文，完成后会停在这里等你判断。'
                    : draft.dirty
                      ? '正文有你的修改，下一步保存并复检。'
                      : run?.commitId
                        ? run.planning?.mode === 'chapter'
                          ? '整章候选已采用，可进入整章复审。'
                          : '本段已采用。可继续下一段，或进入整章审核。'
                        : run?.status === 'approved'
                          ? run.planning?.mode === 'chapter'
                            ? '整章候选已批准，核对事实后采用全部段落。'
                            : '本段已批准，核对事实后采用到章稿。'
                          : actions.waiting
                            ? '核对正文，提出修改或批准当前稿。'
                            : reason || '生成候选后，在正文旁完成审核。'}
                </p>
                {run?.commitId && (
                  <div className="page-actions">
                    <Button variant="default" onClick={() => setSide('assembly')}>
                      进入整章审核
                    </Button>
                    <Button
                      disabled={startDisabled}
                      disabledReason={block || '请先处理未完成的操作'}
                      onClick={start}
                    >
                      重新生成本段
                    </Button>
                  </div>
                )}
              </section>
              {run?.planning?.mode === 'chapter' && (
                <p className="muted">
                  当前是整章候选：批准与采用覆盖全部情节段；选区修改只影响指定正文。
                </p>
              )}
              {!!run?.planning?.neighbors?.length && (
                <p className="muted">
                  衔接参照：
                  {run.planning.neighbors
                    .map(
                      (n) =>
                        `${n.position === 'before' ? '前段' : '后段'}「${n.title}」${n.version ? `${n.state === 'candidate' ? '未采用工作稿' : '采用稿'} v${n.version}` : '尚无已保存正文'}`,
                    )
                    .join('；')}
                </p>
              )}
              {run?.status === 'stale' && (
                <Button
                  disabled={busy || locked || !writer.gate.data?.ready}
                  onClick={() => void writer.revise()}
                >
                  保留本段正文，按最新上下文复检
                </Button>
              )}
              <div className="writing-findings">
                {findings
                  .filter((f) => f.id !== 'author-request-review')
                  .map((f) => (
                    <button key={f.id} onClick={() => selectFinding(f.id)}>
                      <Badge>{f.severity}</Badge>
                      <span>{f.reason}</span>
                    </button>
                  ))}
              </div>

              <RevisionReceipt run={run} />
              <section
                className="writing-revision-form"
                aria-label="修改当前稿"
                hidden={!canRewrite && !instructionDraft.dirty}
              >
                <div className="writing-revision-heading">
                  <strong>修改当前稿</strong>
                  <span>{instruction.trim() ? '未发送' : '填写要求'}</span>
                </div>
                <p className="writing-revision-target">
                  范围：{selection ? '选中的文字' : `「${beat?.title || '当前情节段'}」全文`}
                </p>
                {selection && (
                  <blockquote>
                    {selection.quote}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => instructionDraft.remove('quote')}
                    >
                      清除选区
                    </Button>
                  </blockquote>
                )}
                <label>
                  {t.instruction}
                  <textarea
                    aria-label={t.instruction}
                    data-writing-instruction
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    rows={4}
                    placeholder="指出哪里不合理、希望怎样修改；也可以直接提出疑问。"
                    disabled={!canRewrite || instructionDraft.stale}
                  />
                </label>
                {instructionDraft.stale && <p role="alert">{t.stale}</p>}
                <div className="writing-revision-controls">
                  <small>{Array.from(instruction).length}/1000 字</small>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || !instructionDraft.dirty}
                    onClick={instructionDraft.clear}
                  >
                    清空
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    loading={writer.start.isPending || actions.mutation.isPending}
                    disabled={
                      !canRewrite ||
                      !instruction.trim() ||
                      Array.from(instruction).length > 1000 ||
                      instructionDraft.stale
                    }
                    onClick={() => void sendRewrite()}
                  >
                    {t.sendInstruction}
                  </Button>
                </div>
                {draft.dirty && <p className="muted">请先保存正文修改，再发送要求。</p>}
                {Array.from(instruction).length > 1000 && (
                  <p role="alert">修改要求最多 1000 字，请精简后发送。</p>
                )}
              </section>
              {side === 'review' && (
                <section className="writing-review-actions" aria-label="确认当前稿">
                  <strong>确认当前稿</strong>
                  {(writer.start.isError || actions.mutation.isError) && (
                    <p role="alert">
                      {readableMessage(
                        writer.start.error?.message || actions.mutation.error?.message,
                        '请求结果尚未确认，请检查服务连接后重试原请求。',
                      )}
                    </p>
                  )}
                  {writer.pendingStart && !writer.start.isPending && (
                    <>
                      <small>{t.unknown}</small>
                      <Button onClick={writer.retryStart}>{t.retry}</Button>
                    </>
                  )}
                  {actions.pending && !actions.mutation.isPending && (
                    <>
                      <small>{t.unknown}</small>
                      <Button onClick={actions.retry}>{t.retry}</Button>
                    </>
                  )}
                  {actions.resumable && (
                    <Button
                      disabled={busy || draft.dirty || instructionDraft.dirty}
                      onClick={actions.resume}
                    >
                      恢复未完成的修改
                    </Button>
                  )}
                  {draft.dirty ? (
                    <>
                      <Button
                        variant="human"
                        disabled={!editable || draft.stale}
                        onClick={() => void saveEdit()}
                      >
                        {t.recheck}
                      </Button>
                      <DangerButton
                        disabled={busy}
                        title={t.discardConfirm}
                        description="只放弃本机尚未提交的正文修改，已保存稿件保留。"
                        onConfirm={draft.clear}
                      >
                        {t.discard}
                      </DangerButton>
                    </>
                  ) : run?.commitId ? (
                    <p>
                      <Check size={14} />{' '}
                      {run.planning?.mode === 'chapter' ? '整章候选已采用' : t.accepted} · v
                      {run.draftVersion}
                    </p>
                  ) : (
                    <>
                      {run?.status === 'approved' && (
                        <label className="writing-check">
                          <input
                            type="checkbox"
                            checked={confirmed === `${run?.id}:${run?.draftVersion}`}
                            disabled={!actions.current || busy}
                            onChange={(e) =>
                              setConfirmed(
                                e.target.checked ? `${run?.id}:${run?.draftVersion}` : '',
                              )
                            }
                          />
                          {run?.planning?.mode === 'chapter'
                            ? '我已核对全部段落的事实与台词含义。'
                            : '我已核对本段的事实与台词含义。'}
                        </label>
                      )}
                      {instructionDraft.dirty && (
                        <p className="muted">还有未发送的修改要求，请先发送或清空。</p>
                      )}
                      {!instructionDraft.dirty && run?.approvalBlock && (
                        <p className="muted">
                          {readableMessage(run.approvalBlock, '请先处理检查结果再批准。')}
                        </p>
                      )}
                      <div className="page-actions">
                        {run?.status !== 'approved' ? (
                          <Button
                            variant="default"
                            disabled={
                              !actions.waiting ||
                              busy ||
                              instructionDraft.dirty ||
                              !!run?.approvalBlock
                            }
                            disabledReason={run?.approvalBlock || t.stale}
                            onClick={() => void actions.approve()}
                          >
                            {run?.planning?.mode === 'chapter' ? '批准整章候选' : t.approve}
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            disabled={
                              run?.status !== 'approved' ||
                              !actions.current ||
                              busy ||
                              instructionDraft.dirty ||
                              confirmed !== `${run?.id}:${run?.draftVersion}`
                            }
                            disabledReason={run?.approvalBlock || '先批准当前候选并确认事实'}
                            onClick={() => void actions.commit()}
                          >
                            {run?.planning?.mode === 'chapter' ? '采用整章候选' : t.commit}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                  <small>采用候选不会自动定稿整章。</small>
                </section>
              )}
              <details className="writing-review-details">
                <summary>
                  检查结果与候选历史{findings.length ? ` · ${findings.length} 个问题` : ''}
                </summary>
                <WritingGate run={run} stale={stale} />
                <p className="muted">{t.noScore}</p>
                <label>
                  {t.history}
                  <select
                    aria-label={t.history}
                    disabled={locked || busy}
                    value={writer.activeID ?? ''}
                    onChange={(e) => {
                      writer.setRunId(e.target.value);
                      setSelectedFinding(null);
                    }}
                  >
                    {!writer.gate.data?.runs.length && <option value="">{t.noRun}</option>}
                    {writer.gate.data?.runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        v{r.draftVersion} · {t.statuses[r.status]} ·{' '}
                        {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
              <details>
                <summary>生成范围与自动修订</summary>
                <Button
                  disabled={busy || locked || !!block || !writer.chapterGate.data?.ready}
                  onClick={writer.beginChapter}
                >
                  生成整章候选
                </Button>
                {writer.chapterGate.data?.reason && (
                  <p className="muted">
                    {readableMessage(
                      writer.chapterGate.data.reason,
                      '整章材料暂未就绪，请检查规划或上下文预算。',
                    )}
                  </p>
                )}
                <label className="writing-check">
                  <input
                    type="checkbox"
                    checked={writer.autoRevise}
                    disabled={busy || run?.status === 'running'}
                    onChange={(e) => writer.setAutoRevise(e.target.checked)}
                  />
                  {t.authorize}
                </label>
                <Button
                  disabled={startDisabled}
                  disabledReason={block || t.readOnly}
                  onClick={start}
                >
                  {run ? t.regenerate : t.start}
                </Button>
              </details>
            </div>
          </aside>
          {!focus && !side && (
            <aside className="bible-rail" aria-label={t.knowledge}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.knowledge}
                onClick={() => setSide('bible')}
              >
                <Users size={17} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.review}
                onClick={() => showReview()}
              >
                <ShieldCheck size={17} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.assembly}
                onClick={() => setSide('assembly')}
              >
                <BookOpen size={17} />
              </Button>
              <span>{t.knowledge}</span>
            </aside>
          )}
        </div>
        {!focus && (
          <WritingDrawer
            run={run}
            title={run?.planning?.mode === 'chapter' ? chapter?.title : beat?.title}
            onFinding={selectFinding}
          />
        )}
      </div>
      <Modal open={command} onOpenChange={setCommand} title={t.command}>
        <div className="page-stack">
          {[t.review, t.assembly, t.knowledge].map((label, i) => (
            <Button
              key={label}
              onClick={() => {
                setSide((['review', 'assembly', 'bible'] as const)[i]);
                setCommand(false);
              }}
            >
              {label}
            </Button>
          ))}
          <Button
            onClick={() => {
              useUIStore.getState().setFocus(true);
              setCommand(false);
            }}
          >
            专注写作
          </Button>
        </div>
      </Modal>
      <Modal
        open={regenerate}
        onOpenChange={setRegenerate}
        title="重新生成这一段"
        description="已采用的版本会保留，新候选需要重新审核，不会自动替换整章。"
        footer={
          <Button
            onClick={() => {
              setRegenerate(false);
              writer.begin(true);
            }}
          >
            生成新候选
          </Button>
        }
      >
        {null}
      </Modal>
    </div>
  );
}
