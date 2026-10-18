import { ApiError } from '@/shared/api/client';
import { planningApi } from './planning';
import { chapterPlanApi } from './chapter-plan';
import { plannedRunApi } from './planned-run';
import {
  chapterPlanReady,
  chapterPlanVersions,
  sameChapterPlanVersions,
} from '../types/chapter-plan';

export type ContinuationStep = {
  stage: 'planning' | 'starting' | 'done';
  message: string;
  runId?: string;
};
export class ContinuationBlocked extends Error {
  constructor(
    message: string,
    public retryWithNewId = false,
  ) {
    super(message);
  }
}

// One persisted step at a time. The URL holds the operation ID; after a refresh
// we inspect the stored plan job/selection/run before attempting the next step.
// These are the same version-checked APIs used by manual planning and writing.
export async function advanceChapterContinuation(
  chapterId: string,
  requestId: string,
): Promise<ContinuationStep> {
  const state = await planningApi.get();
  const chapter = state.outlineSelection?.content.chapters.find((c) => c.id === chapterId);
  if (!chapter || !chapterPlanReady(state))
    throw new ContinuationBlocked('已确认章纲或人物设定已变化，请先复核创作准备。');
  const expected = chapterPlanVersions(state);
  const plan = state.chapterPlans?.find((p) => p.chapterId === chapterId);
  if (plan) {
    if (!plan.confirmed || !sameChapterPlanVersions(plan.versions, expected))
      throw new ContinuationBlocked(
        '本章已有未确认或待复核的细纲。请核对这份细纲后继续，已有内容已保留。',
      );
    const gate = await plannedRunApi.get(chapterId, undefined, undefined, 'chapter');
    const recovered = gate.runs.find((r) => r.id === requestId);
    if (recovered) return { stage: 'done', message: '已恢复本次整章创作。', runId: recovered.id };
    const running = gate.runs.find((r) => r.status === 'running');
    if (running)
      return { stage: 'done', message: '本章已有生成任务，继续查看进度。', runId: running.id };
    // Never regenerate existing prose, including unadopted candidates.
    if (gate.missingBeatIds?.length === 0)
      return { stage: 'done', message: '本章各段已有正文，可继续审核或修改。' };
    if (!gate.ready)
      throw new ContinuationBlocked(gate.reason || '本章尚未具备写作条件，请核对创作准备。');
    if (!gate.missingBeatIds)
      throw new ContinuationBlocked('尚未读取到未生成段落，请刷新状态后继续。');
    let run;
    try {
      run = await plannedRunApi.start({
        requestId,
        chapterId,
        mode: 'chapter',
        remaining: true,
        expected: gate.expected,
        planVersion: gate.planVersion,
        draftVersion: 0,
        autoRevise: false,
      });
    } catch (error) {
      const fresh = await plannedRunApi.get(chapterId, undefined, undefined, 'chapter');
      const persisted = fresh.runs.find((r) => r.id === requestId);
      if (!persisted) throw error;
      run = persisted;
    }
    return { stage: 'done', message: '已开始生成本章剩余段落，完成后进入审核。', runId: run.id };
  }
  const job = state.chapterPlanJobs?.find((j) => j.id === requestId);
  if (!job) {
    if (state.chapterPlanJobs?.some((j) => j.status === 'running'))
      throw new ContinuationBlocked('当前还有细纲生成任务，完成后可继续本章。');
    const target = Math.min(chapter.targetWords || 3000, 3000);
    await chapterPlanApi.generate({
      requestId,
      chapterId,
      expected,
      request: `作者已选择自动继续本章：依据已确认章纲、人物与风格，衔接上一章定稿结尾和已确认事实，自动展开本章细纲并用于整章候选创作。全章目标 ${target} 字，尽量不超过 3000 字，按情节分配篇幅，避免各段重复问答和回顾；保留章纲事件、结果及信息披露边界。正文生成后仍交作者审核与采用。`,
    });
    return { stage: 'planning', message: '正在读取前章定稿、已确认事实与故事设定，生成本章细纲…' };
  }
  if (job.input.chapterId !== chapterId)
    throw new ContinuationBlocked('续章请求对应其他章节，请重新开始本章。', true);
  if (job.status === 'running')
    return { stage: 'planning', message: '正在生成本章场景与情节段，完成后会自动开始正文…' };
  if (job.status !== 'completed' || !job.output)
    throw new ContinuationBlocked(job.message || '本章细纲生成未完成，请重试。', true);
  if (!sameChapterPlanVersions(job.request.expected, expected))
    throw new ContinuationBlocked('生成期间章纲或故事设定已变化，请按最新上下文重新开始。', true);
  const index = state.outlineSelection!.content.chapters.findIndex((c) => c.id === chapterId);
  if (index > 0 && !job.input.previousChapter)
    throw new ContinuationBlocked('上一章尚未定稿，暂不能自动续章。请先完成上一章定稿。');
  try {
    await chapterPlanApi.save({
      chapterId,
      expected,
      expectedVersion: 0,
      sourceVersion: 0,
      jobId: job.id,
      candidateVersion: job.version,
      content: { ...job.output, targetWords: Math.min(chapter.targetWords || 3000, 3000) },
      confirmed: true,
    });
  } catch (error) {
    // A response can be lost or another tab can complete this exact step.
    // Only recognize our persisted selection; never overwrite a different one.
    const fresh = await planningApi.get();
    const saved = fresh.chapterPlans?.find((p) => p.chapterId === chapterId);
    if (
      !saved?.confirmed ||
      saved.jobId !== job.id ||
      !sameChapterPlanVersions(saved.versions, expected)
    )
      throw error;
  }
  return {
    stage: 'starting',
    message: '本章细纲已按续章指令启用，正在检索相关材料并准备整章正文…',
  };
}

export const continuationRetryable = (error: unknown) =>
  !(error instanceof ContinuationBlocked) || error.retryWithNewId;
export const continuationNeedsNewId = (error: unknown) =>
  error instanceof ContinuationBlocked
    ? error.retryWithNewId
    : error instanceof ApiError && error.status === 409;
