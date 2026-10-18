import { SelectionRewritePreview } from './selection-rewrite-preview';
import { findingRewrite, replaceFindingQuote } from './finding-actions';
import { ContinuityOption } from '@/features/prepare/components/continuity-option';
import { ReviewProgress } from '@/features/prepare/components/review-progress';
import { ReviewFailure, reviewFailureInfo } from './review-failure';
import { readableMessage } from '@/shared/lib/business-labels';
import type { SelectedText } from '@/features/workspace/editor/SegmentEditor';
import type { ManuscriptInspection } from '@/types/domain/manuscript-view';
import { usePanelDialog } from '@/shared/lib/use-panel-dialog';
import { useEffect, useMemo, useState, useCallback, useRef, useId } from 'react';
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
  Settings2,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { PendingWritingProvider, useWritingLocked } from '@/shared/lib/pending-writing';
import { useUIStore } from '@/shared/lib/ui-store';
import { livePreparePath, liveWorkspacePath } from '@/shared/lib/writing-mode';
import { writingDesk as t } from '@/shared/lib/messages-writing-desk';
import { AsyncState, Badge, Button, Modal } from '@/shared/ui';
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
import { WritingBible, WritingGate, WritingFinding, findingDecision } from './writing-panels';
import { WritingDrawer } from './writing-drawer';
import { inlineEditVisible, useAuthorDraft } from './author-draft';
import './writing.css';
import { RevisionReceipt } from './revision-receipt';
import { ContextReviewNotice } from './context-review-notice';
import { QualitySummary } from './quality-summary';
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
  const nextChapter = chapters[chapters.findIndex((c) => c.id === chapterId) + 1];
  const nextPlan = planning.chapterPlans?.find((p) => p.chapterId === nextChapter?.id);
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
    chapterPlanReady(planning) &&
    !!plan?.confirmed &&
    sameChapterPlanVersions(plan.versions, chapterPlanVersions(planning));
  const instructionOwner = useId();
  const writer = usePlannedWriting(chapterId, beatId, !ready || planningError, instructionOwner);
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
  const [editRequest, setEditRequest] = useState<{
    segmentId: string;
    quote: string;
    requestId: number;
  }>();
  const [selectedFinding, setSelectedFinding] = useState<string | null>(null);
  const [rewriteFeedback, setRewriteFeedback] = useState('');
  const [resumeFinding, setResumeFinding] = useState<{
    runId: string;
    beatId: string;
    quote: string;
    segmentId: string;
  } | null>(null);
  const [editOnOpen, setEditOnOpen] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ManuscriptInspection | null>(null);
  const inspect = (view: ManuscriptInspection) => {
    if (draft.dirty) return;
    setInspection(view);
    if (compact) setSide(null);
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
    instructionOwner,
  );
  const instruction = instructionDraft.texts.instruction ?? '';
  const quote = instructionDraft.texts.quote;
  const selection = useMemo(() => (quote ? { quote } : null), [quote]);
  const setInstruction = (text: string) =>
    text ? instructionDraft.change('instruction', text) : instructionDraft.remove('instruction');
  const acknowledged = actions.mutation.isSuccess ? actions.mutation.variables : undefined;
  useEffect(() => {
    if (
      !run ||
      !acknowledged ||
      acknowledged.runId !== run.id ||
      acknowledged.operation.kind !== 'action'
    )
      return;
    const action = acknowledged.operation.input;
    if (
      action.type === 'inline_edit' &&
      action.segmentId &&
      draft.texts[action.segmentId] === action.text &&
      inlineEditVisible(run, action)
    )
      draft.remove(action.segmentId);
    if (
      (action.type === 'instruct' ||
        action.type === 'rewrite' ||
        action.type === 'propose_selection') &&
      instructionDraft.dirty &&
      (action.type === 'rewrite' || action.type === 'propose_selection'
        ? action.rewrite?.instruction === instruction
        : action.instruction ===
          (selection ? '针对「' + selection.quote + '」：' : '') + instruction)
    )
      instructionDraft.clear();
  }, [acknowledged, run, draft, instructionDraft, selection, instruction]);
  useEffect(() => {
    const request = writer.start.variables;
    if (
      writer.start.isSuccess &&
      request?.rewrite &&
      request.fromRunId &&
      request.sourceVersion !== undefined
    )
      instructionDraft.acknowledgeInstruction(
        request.fromRunId,
        request.sourceVersion,
        request.rewrite.instruction,
      );
  }, [writer.start.isSuccess, writer.start.variables, instructionDraft]);
  const [confirmed, setConfirmed] = useState('');
  const [compact, setCompact] = useState(window.innerWidth < 1200);
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 1200);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [command, setCommand] = useState(false);
  const [checkSettings, setCheckSettings] = useState(false);
  const focus = useUIStore((s) => s.focus),
    leftOpen = useUIStore((s) => s.leftOpen);
  const locked = useWritingLocked();
  const otherRewriteLocks = useWritingLocked(instructionOwner);
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
    setEditOnOpen(null);
    setResumeFinding(null);
    setRewriteFeedback('');
    setConfirmed('');
  }, [beatId]);
  const assembly = useQuery({
    queryKey: ['chapter-assembly', chapterId, {}],
    queryFn: () => assemblyApi.preview(chapterId, {}),
    enabled: !!chapterId && ready,
    retry: false,
    refetchInterval: 5000,
  });
  const busy =
    actions.busy || writer.start.isPending || writer.dismiss.isPending || !!writer.pendingStart;
  const block = !chapter ? t.prerequisite : !ready ? t.prerequisite : (writer.block ?? '');
  // During a run the draft head and SSE snapshot arrive separately. This is
  // normal progress, not evidence that a completed review became obsolete.
  // A lower cached head is catching up; only a newer head invalidates this run.
  const stale =
    run?.status !== 'running' &&
    (draft.stale ||
      run?.status === 'stale' ||
      (!!run &&
        !run.commitId &&
        currentVersion !== undefined &&
        currentVersion > run.draftVersion));
  const adoptedCurrent =
    !!run?.commitId ||
    (!!writer.gate.data?.adopted?.matchesWorking &&
      writer.gate.data?.working?.runId === run?.id &&
      writer.gate.data?.working?.version === run?.draftVersion);
  const adoptedVersion = run?.commitId ? run.draftVersion : writer.gate.data?.adopted?.version;
  const editable = actions.waiting && !busy && !stale && !run?.result?.findingProposal;
  const sourceSegments = (run?.result?.segments ?? []).map((segment) =>
    run?.pendingAction?.type === 'inline_edit' && run.pendingAction.segmentId === segment.id
      ? { ...segment, text: run.pendingAction.text ?? segment.text }
      : segment,
  );
  const findings: Finding[] = (run?.result?.report.findings ?? []).map((f) => ({
    ...f,
    draftVersion: run!.result!.report.draftVersion,
    quote: run?.result?.findingChanges?.find((c) => c.findingId === f.id)?.after || f.quote,
    status: run?.result?.findingChanges?.some((c) => c.findingId === f.id)
      ? 'resolved'
      : findingDecision(run, f.id)?.decision === 'keep'
        ? 'ignored'
        : 'open',
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
          (candidate) => !candidate.dismissed && candidate.result?.segments.length,
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
          adoptedVersion: candidateQuery?.data?.adopted?.version,
          accepted:
            current && sourceSegments.length
              ? !!run.commitId ||
                (!!candidateQuery?.data?.adopted?.matchesWorking &&
                  working?.runId === run.id &&
                  working?.version === run.draftVersion)
              : working
                ? working.state === 'adopted'
                : candidate
                  ? !!candidate.commitId
                  : !!stored?.commitId,
          loading:
            !texts.length &&
            (candidateQuery?.isPending ||
              assembly.isLoading ||
              (b.id === beatId && writer.loading)),
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
    setEditOnOpen(null);
    setSelectedFinding(id);
    if (compact) setSide(null);
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
    if (value.action === 'edit') {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('beatId', part.id);
          if (compact) next.set('panel', 'closed');
          return next;
        },
        { replace: true },
      );
    } else showReview(part.id);
  };
  useEffect(() => {
    if (!pendingSelection || pendingSelection.beatId !== beatId || !run) return;
    const segment = sourceSegments.find((s) => s.id === pendingSelection.segmentId);
    // Switching beats loads the candidate and its saved draft independently.
    // Keep the user's selection until both are ready, before deciding whether editing is allowed.
    if (writer.runQuery.isFetching || writer.draft.isPending) return;
    if (run.planning?.mode === 'beat' && run.planning.beatId !== beatId) return;
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
      (pendingSelection.action !== 'edit' && instructionDraft.stale)
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
      setEditRequest((old) => ({
        segmentId: segment.id,
        quote: pendingSelection.quote,
        requestId: (old?.requestId ?? 0) + 1,
      }));
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
    writer.draft.isPending,
    editable,
    busy,
    instructionDraft,
    draft.dirty,
  ]);
  // Model completion updates data, not the author's reading position or panel.
  const saveEdit = async () => {
    const entry = Object.entries(draft.texts)[0];
    if (!entry || !editable || draft.stale) return;
    // An action receipt can arrive before the SSE snapshot with the saved text.
    // Keep the local text until the acknowledgement effect sees it in that snapshot.
    await actions.edit(entry[0], entry[1]);
  };
  const startDisabled =
    !!block || !writer.gate.data?.ready || locked || busy || run?.status === 'running';
  const start = () => {
    showReview();
    if (startDisabled) return;
    writer.begin(true);
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
  const reviewFailure = reviewFailureInfo(run);
  const reason = stale
    ? t.stale
    : reviewFailure
      ? `${reviewFailure.title}：${reviewFailure.detail}`
      : planningError
        ? '暂时无法读取真实规划，请确认 Go 服务已启动。'
        : run?.error
          ? readableMessage(run.error, '本次修改或复检未完成，请检查结果后重试。')
          : writer.blockIsProgress
            ? ''
            : block;
  const contextRecheck =
    writer.start.variables?.recheck &&
    (writer.start.variables.fromRunId === run?.id || writer.start.data?.id === run?.id);
  const recheckingContext =
    !!contextRecheck &&
    !run?.pendingAction &&
    (writer.start.isPending || (run?.status === 'running' && writer.start.data?.id === run.id));
  const retryContext = !!contextRecheck && !!writer.pendingStart && !writer.start.isPending;
  const reviewGate = run?.planning?.mode === 'chapter' ? writer.chapterGate : writer.gate;
  const contextReviewBlock =
    draft.dirty || instructionDraft.dirty
      ? '本机还有未提交的修改，请先处理这些修改，再复检已保存的正文。'
      : retryContext
        ? '' // Retry the same idempotent request when its outcome is unknown.
        : busy || locked || run?.status === 'running'
          ? '请等待当前操作完成。'
          : !writer.current || !reviewGate.data?.ready || reviewGate.isError
            ? reviewGate.data?.reason || '正在核对创作准备状态；准备就绪后可复检。'
            : '';
  const selectionPreviewRunning =
    run?.status === 'running' &&
    (run.pendingAction?.type === 'propose_selection' ||
      (!run.pendingAction &&
        (run.result?.context.rewrite?.preview ||
          (writer.start.data?.id === run.id && writer.start.variables?.rewrite?.preview))));
  const localActionRunning =
    run?.status === 'running' &&
    [
      'propose_selection',
      'propose_finding',
      'apply_finding',
      'discard_finding',
      'edit_finding',
    ].includes(run.pendingAction?.type ?? '');
  const canRewrite =
    !!run?.result &&
    !busy &&
    run.status !== 'running' &&
    !draft.dirty &&
    !run.result.findingProposal;
  const rewriteInPlace =
    actions.waiting &&
    (run?.planning?.neighborPolicy === 'working-v1' || run?.planning?.mode === 'chapter');
  const rewriteBlock = !canRewrite
    ? draft.dirty
      ? '请先保存正文修改，再发送要求。'
      : '请先完成当前操作。'
    : otherRewriteLocks
      ? '还有其他未保存的修改或未完成请求，请先处理。'
      : instructionDraft.stale
        ? '修改要求对应的正文版本已变化，请核对后清空并重新填写。'
        : rewriteInPlace
          ? ''
          : writer.revisionBlock(true);
  const sendRewrite = async () => {
    setRewriteFeedback('');
    if (rewriteBlock) {
      setRewriteFeedback(rewriteBlock);
      return;
    }
    const segment =
      sourceSegments.find((s) => s.id === instructionDraft.texts.segmentId) ??
      sourceSegments.find((s) => !s.beatId || s.beatId === beatId);
    if (!segment) {
      setRewriteFeedback('未找到对应正文，请重新选择要修改的段落。');
      return;
    }
    try {
      const request = rewriteRequest(segment, instruction, quote);
      if (quote) request.preview = true;
      const ok = await (rewriteInPlace
        ? quote
          ? actions.proposeSelection(request)
          : actions.rewrite(request)
        : writer.revise(request));
      if (ok) {
        instructionDraft.clear();
        setRewriteFeedback(
          quote
            ? '正在生成选区预览，原文保持不变；完成后在原文旁确认。'
            : '修改要求已提交。处理进度和结果见上方当前稿。',
        );
        if (quote) setSide(null);
      } else {
        setRewriteFeedback('修改要求尚未提交，输入已保留。请查看上方状态或重试原请求。');
      }
    } catch (error) {
      setRewriteFeedback(error instanceof Error ? error.message : '无法定位选区，请重新选择。');
    }
  };
  useEffect(() => {
    if (
      !resumeFinding ||
      resumeFinding.beatId !== beatId ||
      !run ||
      run.id === resumeFinding.runId ||
      run.status !== 'waiting_human' ||
      !actions.waiting
    )
      return;
    const matches =
      run.result?.report.findings.filter(
        (f) => f.segmentId === resumeFinding.segmentId && f.quote === resumeFinding.quote,
      ) ?? [];
    setResumeFinding(null);
    if (matches.length === 1) {
      setSelectedFinding(matches[0].id);
      setEditOnOpen(matches[0].id);
    } else {
      setSelectionNotice(
        '审核已更新。旧问题已变化，请选择最新问题修改，也可直接在正文选中需要修改的文字。',
      );
      setSelectedFinding(null);
    }
  }, [resumeFinding, beatId, run, actions.waiting]);
  const recoverFinding = async () => {
    const f = run?.result?.report.findings.find((f) => f.id === selectedFinding);
    if (!run || !f || contextReviewBlock) return;
    setResumeFinding({ runId: run.id, beatId, quote: f.quote, segmentId: f.segmentId });
    setEditOnOpen(null);
    await writer.revise();
  };
  const focusInstruction = () => {
    showReview();
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('[data-writing-instruction]')?.focus(),
    );
  };
  const failureNotice = (
    <ReviewFailure
      run={run}
      disabled={!!contextReviewBlock}
      disabledReason={contextReviewBlock}
      onPendingInstruction={instructionDraft.dirty ? focusInstruction : undefined}
      requestError={
        contextRecheck && writer.start.isError
          ? readableMessage(writer.start.error?.message, '重新检查请求未确认，请重试原请求。')
          : ''
      }
      onRetry={() => {
        if (retryContext) writer.retryStart();
        else void writer.revise();
      }}
    />
  );
  const continuingChapter = parts.some((part) => part.segments.length > 0);
  const primaryLabel = writer.loading
    ? '读取中…'
    : run?.status === 'running'
      ? selectionPreviewRunning
        ? '正在生成选区预览'
        : localActionRunning
          ? run?.pendingAction?.type === 'propose_finding'
            ? '正在生成修改预览'
            : '正在保存局部处理'
          : t.running
      : run?.status === 'committed'
        ? t.assembly
        : run
          ? t.review
          : continuingChapter
            ? '生成本段'
            : '生成整章';
  const primary = () => {
    if (run?.status === 'committed') setSide('assembly');
    else if (run) showReview();
    else if (continuingChapter) start();
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
                        <small>
                          {findings.filter((f) =>
                            part?.segments.some((segment) => segment.id === f.segmentId),
                          ).length || ''}
                        </small>
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
          {parts.filter((p) => p.accepted || p.adoptedVersion).length}/{parts.length} 段已有采用稿 ·
          目标 {(plan?.content.targetWords || chapter?.targetWords)?.toLocaleString() ?? '—'} 字
        </span>
        {parts.some((p) => p.adoptedVersion && !p.accepted) && (
          <small>
            其中 {parts.filter((p) => p.adoptedVersion && !p.accepted).length} 段有新修改待采用
          </small>
        )}
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
              <Button variant="ghost" size="sm" onClick={() => setCheckSettings(true)}>
                <Settings2 size={14} />
                检查设置
              </Button>
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
                  writer.loading ||
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
            <ReviewProgress run={run} />
            {(localActionRunning || selectionPreviewRunning) && (
              <div className="writing-operation-progress" role="status" aria-label="局部处理进度">
                {selectionPreviewRunning
                  ? '正在生成选中文字的修改预览，正文尚未改变。'
                  : run?.pendingAction?.type === 'propose_finding'
                    ? '正在生成这条问题的修改预览，正文尚未改变。'
                    : '正在保存你的局部处理，不会重新审核整段。'}
              </div>
            )}
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
                <Button size="sm" onClick={() => setSide('assembly')}>
                  继续整章审核
                </Button>
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
                snapshot={!!inspection}
                parts={inspectedParts ?? parts}
                activeBeat={inspection ? '' : beatId}
                title={inspection?.title ?? beat?.title ?? chapter?.title ?? ''}
                pov={planning.styleSelection?.rules.pov ?? ''}
                tone={planning.styleSelection?.rules.tone}
                findings={inspection?.findings ?? findings}
                selectedFinding={selectedFinding}
                editable={editable && !inspection}
                localText={draft.texts}
                editRequest={editRequest}
                dirty={draft.dirty}
                blocked={stale || reviewFailure || run?.status === 'running' ? '' : reason}
                reviewNotice={
                  !inspection && reviewFailure ? (
                    side !== 'review' || focus ? (
                      failureNotice
                    ) : undefined
                  ) : !inspection &&
                    (stale || recheckingContext || (contextRecheck && writer.start.isError)) ? (
                    <ContextReviewNotice
                      running={recheckingContext}
                      onPendingInstruction={instructionDraft.dirty ? focusInstruction : undefined}
                      disabledReason={recheckingContext ? '' : contextReviewBlock}
                      retry={retryContext}
                      error={
                        contextRecheck && writer.start.isError
                          ? readableMessage(writer.start.error?.message, '复检未提交成功，请重试。')
                          : ''
                      }
                      onRecheck={() => {
                        if (retryContext) writer.retryStart();
                        else void writer.revise();
                      }}
                    />
                  ) : undefined
                }
                selectionPreview={
                  run?.result?.findingProposal &&
                  !run.result.findingProposal.findingId &&
                  !inspection
                    ? {
                        id: run.result.findingProposal.id,
                        segmentId: run.result.findingProposal.request.segmentId,
                        quote: Array.from(run.result.findingProposal.request.original)
                          .slice(
                            run.result.findingProposal.request.start,
                            run.result.findingProposal.request.end,
                          )
                          .join(''),
                        content: (
                          <SelectionRewritePreview
                            proposal={run.result.findingProposal}
                            busy={busy || !actions.waiting}
                            onApply={actions.applyFinding}
                            onDiscard={actions.discardFinding}
                          />
                        ),
                      }
                    : undefined
                }
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
                onDiscard={draft.clear}
                saveBlockedReason={
                  draft.stale ? '保存版本已变化，你的修改仍保留，请先核对当前版本。' : undefined
                }
                saveError={
                  actions.mutation.isError &&
                  actions.mutation.variables?.operation.kind === 'action' &&
                  actions.mutation.variables.operation.input.type === 'inline_edit'
                    ? readableMessage(
                        actions.mutation.error?.message,
                        '保存未完成，修改仍保留，请重试。',
                      )
                    : undefined
                }
                onRetrySave={
                  actions.pending?.operation.kind === 'action' &&
                  actions.pending.operation.input.type === 'inline_edit' &&
                  !actions.mutation.isPending
                    ? actions.retry
                    : undefined
                }
                onStart={start}
                onReview={showReview}
                startDisabled={startDisabled}
              >
                {selectedFinding && !inspection && (
                  <WritingFinding
                    run={run}
                    id={selectedFinding}
                    onClose={() => setSelectedFinding(null)}
                    key={`${run?.id}:${run?.draftVersion}:${selectedFinding}:${editOnOpen === selectedFinding}`}
                    busy={busy || run?.status === 'running'}
                    initialEdit={editOnOpen === selectedFinding}
                    onRecover={
                      !editable && !busy && run?.status !== 'running'
                        ? () => void recoverFinding()
                        : undefined
                    }
                    recoveryBlock={contextReviewBlock}
                    onPendingInstruction={instructionDraft.dirty ? focusInstruction : undefined}
                    editBlock={
                      !editable || draft.dirty || instructionDraft.dirty
                        ? draft.dirty || instructionDraft.dirty
                          ? '请先保存或放弃已有修改，再处理这条问题。'
                          : run?.commitId
                            ? '这是已采用稿。请先在作者审核中生成新候选，再直接修改。'
                            : stale
                              ? '相邻正文或当前稿已变化，更新审核后可继续修改。'
                              : '正在同步当前稿状态，请稍候。'
                        : ''
                    }
                    rewriteBlock={
                      !canRewrite ||
                      stale ||
                      instructionDraft.dirty ||
                      instructionDraft.stale ||
                      (!actions.waiting &&
                        run?.result?.report.findings.some(
                          (f) =>
                            f.id === selectedFinding &&
                            f.severity === 'P3' &&
                            f.id !== 'author-request-review',
                        ))
                        ? '请先处理未保存的修改或当前运行，再发送这条问题。'
                        : ''
                    }
                    decisionBlock={
                      !editable ||
                      draft.dirty ||
                      instructionDraft.dirty ||
                      selectedFinding === 'author-request-review'
                        ? selectedFinding === 'author-request-review'
                          ? '这条是修改要求的核对结果，请修改或重新核对后处理。'
                          : instructionDraft.dirty
                            ? '请先发送或清空右栏的修改要求。'
                            : stale
                              ? '上下文已变化，请先更新审核再决定保留。'
                              : '请先保存当前修改或等待操作完成。'
                        : ''
                    }
                    onEdit={async (replacement) => {
                      if (!editable || draft.dirty || instructionDraft.dirty) return false;
                      const f = run?.result?.report.findings.find((f) => f.id === selectedFinding);
                      if (f?.severity === 'P3' && f.id !== 'author-request-review') {
                        const ok = await actions.editFinding(
                          selectedFinding,
                          findingRewrite(run, selectedFinding, '作者直接修改这处原文', false),
                          replacement,
                        );
                        if (ok) setSelectedFinding(null);
                        return ok;
                      }
                      const change = replaceFindingQuote(run, selectedFinding, replacement);
                      return actions.edit(change.segmentId, change.text);
                    }}
                    onInstruct={async (instruction, whole) => {
                      if (!canRewrite || stale || instructionDraft.dirty) return false;
                      const request = findingRewrite(run, selectedFinding, instruction, whole);
                      const f = run?.result?.report.findings.find((f) => f.id === selectedFinding);
                      if (f?.severity === 'P3' && f.id !== 'author-request-review')
                        return actions.proposeFinding(selectedFinding, request);
                      const inPlace =
                        actions.waiting &&
                        (run?.planning?.neighborPolicy === 'working-v1' ||
                          run?.planning?.mode === 'chapter');
                      const ok = await (inPlace
                        ? actions.rewrite(request)
                        : writer.revise(request));
                      if (ok) showReview();
                      return ok;
                    }}
                    onApply={async (id) => {
                      if (stale || draft.dirty || instructionDraft.dirty) return false;
                      const ok = await actions.applyFinding(id);
                      if (ok) setSelectedFinding(null);
                      return ok;
                    }}
                    onDiscard={async (id) => actions.discardFinding(id)}
                    onDecision={async (decision, reason) => {
                      if (!editable || draft.dirty || instructionDraft.dirty) return false;
                      return actions.decideFinding(selectedFinding, decision, reason);
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
              <WritingBible
                planning={planning}
                chapterId={chapterId}
                runId={run?.id}
                beatId={beatId}
              />
            </div>
            <div className="writing-panel-scroll" hidden={side !== 'assembly'}>
              {!!chapterId && (
                <ChapterAssembly
                  chapterId={chapterId}
                  editing={!ready || draft.dirty || planningError}
                  embedded
                  enhancedContinuity={writer.enhancedContinuity}
                  onRead={inspect}
                  onReviewBeat={showReview}
                  continuation={
                    nextChapter
                      ? {
                          label: `继续第 ${chapters.indexOf(nextChapter) + 1} 章 · ${nextChapter.title}`,
                          onClick: () =>
                            navigate(
                              nextPlan?.confirmed
                                ? liveWorkspacePath(nextChapter.id)
                                : livePreparePath('outline', nextChapter.id),
                            ),
                        }
                      : undefined
                  }
                />
              )}
            </div>
            <div className="writing-panel-scroll writing-review-scroll" hidden={side !== 'review'}>
              {failureNotice}
              <section
                hidden={!!reviewFailure}
                className="writing-next-step"
                aria-label="当前稿与下一步"
                aria-live="polite"
              >
                <strong>
                  {run?.planning?.mode === 'chapter' ? chapter?.title : beat?.title || '当前情节段'}
                  {run ? ` · v${run.draftVersion}` : ''}
                </strong>
                <p>
                  {writer.loading
                    ? '正在读取当前稿与审核状态…'
                    : run?.status === 'running'
                      ? selectionPreviewRunning || run.pendingAction?.type === 'propose_finding'
                        ? '正在生成局部修改预览，正文保持不变。'
                        : ['apply_finding', 'edit_finding', 'discard_finding'].includes(
                              run.pendingAction?.type ?? '',
                            )
                          ? '正在保存局部处理，不会重新审核整段。'
                          : '正在生成或复检正文，完成后会停在这里等你判断。'
                      : draft.dirty
                        ? '正文有你的修改，下一步保存并复检。'
                        : adoptedCurrent
                          ? run?.planning?.mode === 'chapter'
                            ? '整章候选已采用，可进入整章复审。'
                            : '本段已采用。可继续下一段，或进入整章审核。'
                          : run?.status === 'approved'
                            ? run.planning?.mode === 'chapter'
                              ? '整章候选已批准，核对事实后采用全部段落。'
                              : '本段已批准，核对事实后采用到章稿。'
                            : run?.result?.findingProposal
                              ? '局部修改预览已就绪，请在正文旁核对后确认替换。'
                              : run?.result?.reviewPending
                                ? '局部修改已保存。可继续处理其他问题，完成后统一复审。'
                                : actions.waiting
                                  ? '核对正文，提出修改或批准当前稿。'
                                  : reason || '生成候选后，在正文旁完成审核。'}
                </p>
                {!!writer.gate.data?.adopted && !adoptedCurrent && (
                  <p className="muted">
                    已采用 v{writer.gate.data.adopted.version} 保留；当前 v{run?.draftVersion}{' '}
                    是修改后的候选，需要确认的是新正文。
                  </p>
                )}
                {run?.neighborsChanged && !stale && (
                  <p className="muted" role="status">
                    邻段已更新，衔接将在整章复审核对。
                    {adoptedCurrent
                      ? '已采用正文继续有效，无需重复采用。'
                      : '可继续审核当前候选，无需因邻段变化先复检。'}
                  </p>
                )}
                {stale && (
                  <div className="page-actions">
                    {instructionDraft.dirty ? (
                      <Button size="sm" onClick={focusInstruction}>
                        处理未发送的修改要求
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={!!contextReviewBlock}
                        disabledReason={contextReviewBlock}
                        onClick={() => {
                          if (retryContext) writer.retryStart();
                          else void writer.revise();
                        }}
                      >
                        更新本段审核
                      </Button>
                    )}
                  </div>
                )}
                {run?.result?.findingProposal?.findingId && (
                  <Button
                    size="sm"
                    onClick={() => setSelectedFinding(run.result!.findingProposal!.findingId)}
                  >
                    查看待确认修改
                  </Button>
                )}
                {run?.result?.reviewPending && !stale && (
                  <section className="finding-batch-status" aria-label="待统一复审">
                    <p>
                      已保存 {run.result.findingChanges?.length ?? 0}{' '}
                      处局部修改。其余意见来自上一版，暂不重新编号；批准前需复审最新正文。
                    </p>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={
                        busy ||
                        !!run.result.findingProposal ||
                        draft.dirty ||
                        instructionDraft.dirty ||
                        !actions.waiting
                      }
                      onClick={() => void actions.reviewBatch()}
                    >
                      统一复审当前稿
                    </Button>
                  </section>
                )}
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
              <div className="writing-findings">
                {findings
                  .filter((f) => f.id !== 'author-request-review' && f.status === 'open')
                  .map((f) => (
                    <button key={f.id} onClick={() => selectFinding(f.id)}>
                      <Badge>{f.severity}</Badge>
                      <span>{f.reason}</span>
                    </button>
                  ))}
              </div>

              {findings.some((f) => f.status === 'resolved') && (
                <details className="writing-kept-findings" open>
                  <summary>
                    已修改 · 待复审 {findings.filter((f) => f.status === 'resolved').length}
                  </summary>
                  {findings
                    .filter((f) => f.status === 'resolved')
                    .map((f) => (
                      <Button
                        key={f.id}
                        size="sm"
                        variant="ghost"
                        onClick={() => selectFinding(f.id)}
                      >
                        {f.quote || '查看这处修改'}
                      </Button>
                    ))}
                </details>
              )}
              {findings.some((f) => f.status === 'ignored') && (
                <details className="writing-kept-findings">
                  <summary>
                    已保留原文 · {findings.filter((f) => f.status === 'ignored').length}
                  </summary>
                  {findings
                    .filter((f) => f.status === 'ignored')
                    .map((f) => (
                      <Button
                        key={f.id}
                        variant="ghost"
                        size="sm"
                        onClick={() => selectFinding(f.id)}
                      >
                        {f.quote || '查看作者判断'}
                      </Button>
                    ))}
                </details>
              )}

              {!run?.result?.reviewPending && (
                <QualitySummary
                  run={run}
                  dirty={draft.dirty}
                  onPrepareCondense={
                    canRewrite && !stale && !instructionDraft.dirty && !instructionDraft.stale
                      ? (target) => {
                          const segment = sourceSegments.find(
                            (s) => !s.beatId || s.beatId === beatId,
                          );
                          if (!segment) return;
                          instructionDraft.change('segmentId', segment.id);
                          instructionDraft.remove('quote');
                          setInstruction(
                            `请将当前情节段精简到约 ${target} 字，优先删除重复描写、反复确认和过度解释。保留关键动作、人物关系、数量与事件结果，保持与前后段的衔接；不添加新事实、不截断结尾，只改本段。`,
                          );
                          requestAnimationFrame(() => {
                            const field = document.querySelector<HTMLTextAreaElement>(
                              '[data-writing-instruction]',
                            );
                            field?.focus();
                            field?.scrollIntoView({ block: 'nearest' });
                          });
                        }
                      : undefined
                  }
                />
              )}
              {!stale &&
                !reviewFailure &&
                !localActionRunning &&
                !run?.result?.findingProposal &&
                !run?.result?.reviewPending && <RevisionReceipt run={run} />}
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
                      !!rewriteBlock ||
                      !instruction.trim() ||
                      Array.from(instruction).length > 1000 ||
                      instructionDraft.stale
                    }
                    disabledReason={rewriteBlock}
                    onClick={() => void sendRewrite()}
                  >
                    {t.sendInstruction}
                  </Button>
                </div>
                {(rewriteFeedback || rewriteBlock) && (
                  <p role="status">{rewriteFeedback || rewriteBlock}</p>
                )}
                {Array.from(instruction).length > 1000 && (
                  <p role="alert">修改要求最多 1000 字，请精简后发送。</p>
                )}
              </section>
              {side === 'review' && !draft.dirty && (
                <section className="writing-review-actions" aria-label="确认当前稿">
                  <strong>确认当前稿</strong>
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
                  {adoptedCurrent ? (
                    <p>
                      <Check size={14} />{' '}
                      {run?.planning?.mode === 'chapter' ? '整章候选已采用' : t.accepted} · v
                      {adoptedVersion}
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
                  {run?.canDismiss && !adoptedCurrent && (
                    <Button
                      variant="ghost"
                      disabled={busy || locked || instructionDraft.dirty}
                      loading={writer.dismiss.isPending}
                      onClick={() => writer.dismiss.mutate()}
                    >
                      放弃新候选，保留已采用稿
                    </Button>
                  )}
                  {writer.dismiss.isError && <p role="alert">{writer.dismiss.error.message}</p>}
                  <small>采用候选不会自动定稿整章。</small>
                </section>
              )}
              <details className="writing-review-details">
                <summary>
                  检查结果与候选历史{findings.length ? ` · ${findings.length} 个问题` : ''}
                </summary>
                <WritingGate run={run} stale={stale} />
                {run && (
                  <p className="muted">
                    本轮加强衔接检查：{run.planning?.enhancedContinuity ? '已开启' : '未开启'}
                  </p>
                )}
                {run?.result &&
                  !['running', 'failed', 'interrupted', 'stale'].includes(run.status) && (
                    <Button
                      variant="secondary"
                      disabled={
                        busy ||
                        locked ||
                        draft.dirty ||
                        instructionDraft.dirty ||
                        !!writer.pendingStart ||
                        !(run.planning?.mode === 'chapter'
                          ? writer.chapterGate.data?.ready
                          : writer.gate.data?.ready)
                      }
                      onClick={() => void writer.revise()}
                    >
                      保留正文，重新检查
                    </Button>
                  )}

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
                        v{r.draftVersion} · {r.dismissed ? '已放弃' : t.statuses[r.status]} ·{' '}
                        {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
              <details>
                <summary>生成范围与自动修订</summary>
                <Button
                  disabled={
                    busy ||
                    run?.status === 'running' ||
                    !!run?.pendingAction ||
                    locked ||
                    !!block ||
                    !writer.chapterGate.data?.ready
                  }
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
      <Modal
        open={checkSettings}
        onOpenChange={setCheckSettings}
        title="检查设置"
        description="本次工作台的段落生成、整章生成和整章复审共用。只用于新任务，已开始的检查保持原设置。"
        footer={<Button onClick={() => setCheckSettings(false)}>完成</Button>}
      >
        <ContinuityOption
          checked={writer.enhancedContinuity}
          onChange={writer.setEnhancedContinuity}
          disabled={busy || locked || !!writer.pendingStart}
        />
      </Modal>
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
    </div>
  );
}
