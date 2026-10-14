import type {
  ChapterDocument,
  ChangeSet,
  ContextManifest,
  RunEvent,
  RunEventType,
  RunNode,
  RunState,
} from '../types/domain';
import { db, document, persist, refresh, uid, makePatch, allConflicts } from './data/db';
import { now, seedRun } from './data/seed';
type Step = { type: RunEventType; data: RunEvent['data'] };
const plans = new Map<string, Step[]>();
const propagationVersions = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(event: RunEvent) => void>>();
export function clearRuns() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  plans.clear();
  propagationVersions.clear();
  listeners.clear();
}
export function emit(run: RunState, type: RunEventType, data: RunEvent['data'] = {}): RunEvent {
  const event: RunEvent = {
    id: uid('event'),
    type,
    runId: run.id,
    draftVersion: run.draftVersion,
    timestamp: now(),
    data: { ...data, run: structuredClone(run) },
  };
  (db.events[run.id] ??= []).push(event);
  if (db.events[run.id].length > 240) db.events[run.id].shift();
  listeners.get(run.id)?.forEach((fn) => fn(event));
  persist();
  return event;
}
function stepNode(node: RunNode, message: string): Step[] {
  return [
    { type: 'node.started', data: { node, message } },
    { type: 'node.finished', data: { node, message } },
  ];
}
export function scheduleReview(
  doc: ChapterDocument,
  mode: 'full' | 'micro' | 'structural' = 'full',
  fresh = false,
  maxRounds: 2 | 3 = doc.run.maxRounds,
): RunState {
  const run = fresh ? seedRun(doc.chapter.id, doc.run.branchId, doc.chapter.draftVersion) : doc.run;
  clearTimeout(timers.get(run.id));
  propagationVersions.delete(run.id);
  if (fresh) {
    run.id = uid('run');
    run.tokens = 0;
    run.elapsedMs = 0;
  }
  run.status = 'running';
  run.currentNode = 'assemble';
  run.draftVersion = doc.chapter.draftVersion;
  run.reviseRound = 0;
  run.maxRounds = maxRounds;
  run.nodes.forEach((n) => {
    n.status = 'idle';
    n.inputVersion = run.draftVersion;
  });
  doc.run = run;
  db.runs[run.id] = run;
  refresh(doc);
  const plan: Step[] = [...stepNode('assemble', '检索角色、知识状态、时间线与风格锚点')];
  if (mode === 'full')
    plan.push(...stepNode('draft', '准备候选；不会覆盖作者正文'), {
      type: 'draft.delta',
      data: { text: '候选：让停顿承担未说出口的情绪。', segmentId: doc.segments[0]?.id },
    });
  if (mode === 'micro')
    plan.push(...stepNode('micro_polisher', '局部润色候选已接受，准备复核风格与一致性'));
  const critics: RunNode[] =
    mode === 'micro'
      ? ['style', 'hard_consistency']
      : ['hard_consistency', 'style', 'ai_taste', 'reader'];
  for (const type of ['node.started', 'node.finished'] as const)
    for (const node of critics)
      plan.push({ type, data: { node, message: `基于 v${run.draftVersion} 并行执行 ${node}` } });
  plan.push(
    { type: 'findings.ready', data: { findings: structuredClone(doc.findings) } },
    ...stepNode('aggregate', '汇总质量门禁与修订范围'),
  );
  if (doc.conflicts.some((c) => c.status === 'open'))
    plan.push({
      type: 'conflict.created',
      data: { message: '正文与设定存在未裁决冲突，需要作者选择处理方案。' },
    });
  if (doc.scores.p0Count) {
    for (let round = 1; round <= run.maxRounds; round++)
      plan.push(
        {
          type: 'revise.round',
          data: {
            round,
            max: run.maxRounds,
            message: `结构修订 ${round}/${run.maxRounds} · P0 回退到场景与节拍`,
          },
        },
        ...stepNode('structural_reviser', '重建知识披露次序；产生候选补丁'),
        ...stepNode('hard_consistency', '重新核对人物可知信息'),
        ...stepNode('aggregate', 'P0 候选尚未被作者接受'),
      );
    plan.push({
      type: 'escalated',
      data: {
        node: 'human_gate',
        message: `已达到 ${run.maxRounds}/${run.maxRounds} 修订上限；P0 未解决，交由作者裁决。`,
      },
    });
  } else
    plan.push({
      type: 'gate.waiting',
      data: {
        node: 'human_gate',
        message: doc.scores.canFinalize
          ? '质量门禁通过，等待作者批准定稿。'
          : '审阅完成，剩余候选等待作者处理。',
      },
    });
  plans.set(run.id, plan);
  emit(run, 'run.started', {
    message: mode === 'micro' ? '已接受局部补丁，重跑风格与一致性' : '章节审阅开始',
  });
  tickLater(run);
  return run;
}
function tickLater(run: RunState) {
  timers.set(
    run.id,
    setTimeout(() => {
      advance(run);
      if (run.status === 'running' && plans.get(run.id)?.length) tickLater(run);
    }, 190),
  );
}
export function advance(run: RunState) {
  if (run.status !== 'running') return;
  const doc = document(run.chapterId, run.branchId);
  if (doc.chapter.draftVersion !== (propagationVersions.get(run.id) ?? run.draftVersion)) {
    run.status = 'failed';
    emit(run, 'version.stale', { message: '正文版本已改变，本轮结果已失效。' });
    plans.delete(run.id);
    return;
  }
  const step = plans.get(run.id)?.shift();
  if (!step) return;
  run.elapsedMs += 190;
  run.tokens += step.type === 'node.finished' ? 860 : 0;
  if (step.data.node) {
    run.currentNode = step.data.node;
    const n = run.nodes.find((n) => n.id === step.data.node);
    if (n) {
      n.status =
        step.type === 'node.started' ||
        (step.type === 'index.updating' && step.data.phase !== 'ready')
          ? 'running'
          : 'done';
      n.inputVersion = run.draftVersion;
      n.output = step.data.message ?? '';
      n.tokens = 860;
      n.durationMs = 190;
    }
  }
  if (step.type === 'revise.round') run.reviseRound = step.data.round ?? 0;
  if (
    step.type === 'node.finished' &&
    ['structural_reviser', 'micro_polisher'].includes(step.data.node ?? '')
  )
    for (const finding of doc.findings.filter((f) => f.status === 'open')) makePatch(doc, finding);
  if (step.type === 'escalated') {
    run.status = 'escalated';
    doc.chapter.status = 'human';
  }
  if (step.type === 'gate.waiting') {
    run.status = 'waiting_human';
    doc.chapter.status = 'in_review';
  }
  if (step.type === 'run.finished') run.status = 'completed';
  emit(run, step.type, step.data);
}
/** Propagation has its own progress stream; it never certifies an earlier prose review. */
export function schedulePropagation(doc: ChapterDocument, change: ChangeSet): RunState {
  const previous = doc.run;
  if (previous.status === 'running') cancel(previous);
  const run: RunState = {
    ...structuredClone(previous),
    id: uid('propagation'),
    status: 'running',
    currentNode: 'bible_update',
    tokens: 0,
    elapsedMs: 0,
    nodes: previous.nodes.map((node) => ({ ...node, status: 'idle' })),
  };
  doc.run = run;
  db.runs[run.id] = run;
  propagationVersions.set(run.id, doc.chapter.draftVersion);
  const impacted = change.blastRadius.length;
  const pending = allConflicts(run.branchId).filter(
    (conflict) => conflict.status === 'open',
  ).length;
  const summary = `传播完成：${impacted} 处文本受影响，${pending} 个冲突待裁决；关联正文仍需作者复核。`;
  const phases = [
    { phase: 'checking', message: `正在检查 ${impacted} 处关联文本的版本与约束` },
    { phase: 'indexing', message: '正在更新设定关联与检索索引' },
    { phase: 'summarizing', message: '正在汇总受影响章节、待审候选与冲突' },
    { phase: 'ready', message: summary },
  ];
  plans.set(run.id, [
    ...phases.map((data) => ({
      type: 'index.updating' as const,
      data: { ...data, node: 'bible_update' as const },
    })),
    { type: 'run.finished', data: { node: 'bible_update', phase: 'ready', message: summary } },
  ]);
  emit(run, 'run.started', {
    node: 'bible_update',
    phase: 'checking',
    message: '变更已应用，开始传播与索引更新。正文不会被后台替换。',
  });
  advance(run);
  tickLater(run);
  return run;
}
export function fastForward(run: RunState) {
  clearTimeout(timers.get(run.id));
  if (run.status === 'paused') run.status = 'running';
  for (let i = 0; i < 200 && run.status === 'running' && plans.get(run.id)?.length; i++)
    advance(run);
}
export function pause(run: RunState) {
  clearTimeout(timers.get(run.id));
  run.status = 'paused';
  emit(run, 'node.finished', {
    node: run.currentNode,
    message: '作者暂停了执行；候选与上下文保留。',
  });
}
export function resume(run: RunState) {
  if (!plans.get(run.id)?.length) return scheduleReview(document(run.chapterId, run.branchId));
  run.status = 'running';
  emit(run, 'node.started', { node: run.currentNode, message: '从暂停处继续' });
  tickLater(run);
  return run;
}
export function cancel(run: RunState) {
  clearTimeout(timers.get(run.id));
  plans.delete(run.id);
  run.status = 'canceled';
  emit(run, 'run.finished', { message: '执行已取消，正文未变更。' });
}
export function context(run: RunState): ContextManifest {
  return {
    runId: run.id,
    draftVersion: run.draftVersion,
    tokenEstimate: 6540,
    budget: 12000,
    sources: [
      {
        id: 'char-shen',
        title: '角色卡 · 沈砚',
        version: 2,
        method: 'direct',
        tokens: 720,
        excerpt: '惯用左手；右腕旧伤；直到第九章才确认周岑身份。',
      },
      {
        id: 'info-stranger',
        title: '知识状态 · 陌生人的身份',
        version: 1,
        method: 'graph',
        tokens: 380,
        excerpt: '陆青知道周岑身份；沈砚不知道。禁止越界披露。',
      },
      {
        id: 'foreshadow-button',
        title: '伏笔 · 铜扣三道划痕',
        version: 1,
        method: 'graph',
        tokens: 460,
        excerpt: '第二章植入，第七章计划回收，与第三班开闸有关。',
      },
      {
        id: 'style-main',
        title: '作者风格锚点',
        version: 3,
        method: 'vector',
        tokens: 1320,
        excerpt: '雨停了。檐角还在落水，隔很久，才响一声。',
      },
      {
        id: 'ch6',
        title: '上一章 · 空铃',
        version: 1,
        method: 'direct',
        tokens: 1860,
        excerpt: '陆青在渡口约沈砚夜谈，未透露周岑身份。',
      },
      {
        id: 'time-night',
        title: '时间线 · 夜间封航',
        version: 1,
        method: 'keyword',
        tokens: 1800,
        excerpt: '23:10 渡口封航，旧闸成为唯一通道。',
      },
    ],
    excluded: [
      { title: '第九章身份揭晓正文', reason: '未来章节仅作为知识边界约束，不泄露到生成上下文。' },
      { title: '关系线 B 候选对白', reason: '不属于当前分支的正典。' },
    ],
  };
}
export function eventResponse(request: Request, run: RunState) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const send = (event: RunEvent) => {
        if (ended) return;
        try {
          controller.enqueue(
            encoder.encode(
              `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
        } catch {
          cleanup();
        }
      };
      const last =
        request.headers.get('Last-Event-ID') ??
        new URL(request.url).searchParams.get('lastEventId');
      const events = db.events[run.id] ?? [];
      const index = last ? events.findIndex((e) => e.id === last) : -1;
      for (const event of events.slice(index + 1)) send(event);
      if (['completed', 'canceled', 'failed', 'escalated'].includes(run.status)) {
        ended = true;
        controller.close();
        return;
      }
      const set = listeners.get(run.id) ?? new Set();
      const listener = (event: RunEvent) => {
        send(event);
        if (
          ['run.finished', 'run.failed', 'version.stale', 'escalated', 'gate.waiting'].includes(
            event.type,
          )
        ) {
          cleanup();
          try {
            controller.close();
          } catch {
            /* Reader already canceled. */
          }
        }
      };
      set.add(listener);
      listeners.set(run.id, set);
      const heartbeat = setInterval(() => {
        if (!ended)
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            cleanup();
          }
      }, 15000);
      cleanup = () => {
        ended = true;
        clearInterval(heartbeat);
        set.delete(listener);
      };
      request.signal.addEventListener(
        'abort',
        () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* Already closed. */
          }
        },
        { once: true },
      );
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
