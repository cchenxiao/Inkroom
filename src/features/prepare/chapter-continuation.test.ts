import { beforeEach, expect, it, vi } from 'vitest';
import { advanceChapterContinuation } from './api/chapter-continuation';
import { planningApi } from './api/planning';
import { chapterPlanApi } from './api/chapter-plan';
import { plannedRunApi, type PlannedRunReadiness } from './api/planned-run';
import type { PlanningState } from './types/planning';
import type { ChapterPlanJob, ChapterPlanSelection } from './types/chapter-plan';
import type { BackendRun } from './types/backend';
import { ApiError } from '@/shared/api/client';

const versions = {
  planning: { input: 1, direction: 1, style: 1, core: 1 },
  outline: 1,
  bindings: 1,
};
let state: PlanningState;
const job = (status = 'completed') =>
  ({
    id: 'operation',
    status,
    version: 1,
    request: { expected: versions },
    input: {
      chapterId: 'c2',
      previousChapter: { chapterId: 'c1', ending: '前章结尾', facts: [{ text: '已确认事实' }] },
    },
    output: { scenes: [{ id: 's', beats: [{ id: 'b' }] }], brief: { selectedBeatId: 'b' } },
  }) as ChapterPlanJob;
const selection = () =>
  ({
    chapterId: 'c2',
    version: 1,
    confirmed: true,
    versions,
    jobId: 'operation',
  }) as ChapterPlanSelection;
beforeEach(() => {
  vi.restoreAllMocks();
  state = {
    input: { version: 1 },
    selection: { inputVersion: 1 },
    directionVersion: 1,
    styleVersion: 1,
    styleSelection: { version: 1, inputVersion: 1, directionVersion: 1 },
    coreVersion: 1,
    coreSelection: {
      version: 1,
      inputVersion: 1,
      directionVersion: 1,
      styleVersion: 1,
      content: { characters: [{ id: 'c' }] },
      decisions: { c: 'confirmed' },
    },
    outlineVersion: 1,
    outlineSelection: {
      version: 1,
      bindingsVersion: 1,
      versions: versions.planning,
      confirmed: true,
      content: { chapters: [{ id: 'c1' }, { id: 'c2', targetWords: 6000 }] },
    },
    chapterPlans: [],
    chapterPlanJobs: [],
  } as unknown as PlanningState;
  vi.spyOn(planningApi, 'get').mockImplementation(async () => structuredClone(state));
  vi.spyOn(chapterPlanApi, 'generate').mockResolvedValue(job('running'));
  vi.spyOn(chapterPlanApi, 'save').mockImplementation(async () => {
    const p = selection();
    state.chapterPlans = [p];
    return p;
  });
  vi.spyOn(plannedRunApi, 'get').mockResolvedValue({
    ready: true,
    runs: [],
    missingBeatIds: ['b2'],
    expected: versions,
    planVersion: 1,
  } as unknown as PlannedRunReadiness);
  vi.spyOn(plannedRunApi, 'start').mockResolvedValue({
    id: 'operation',
    status: 'running',
  } as BackendRun);
});
it('continues through persisted planning, selection and whole-chapter generation without author re-entry', async () => {
  expect((await advanceChapterContinuation('c2', 'operation')).stage).toBe('planning');
  expect(chapterPlanApi.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: 'operation',
      chapterId: 'c2',
      request: expect.stringContaining('目标 3000 字'),
    }),
  );
  state.chapterPlanJobs = [job('running')];
  await advanceChapterContinuation('c2', 'operation');
  expect(chapterPlanApi.generate).toHaveBeenCalledTimes(1);
  state.chapterPlanJobs = [job()];
  expect((await advanceChapterContinuation('c2', 'operation')).stage).toBe('starting');
  expect(chapterPlanApi.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedVersion: 0,
      confirmed: true,
      content: expect.objectContaining({ targetWords: 3000 }),
    }),
  );
  expect((await advanceChapterContinuation('c2', 'operation')).runId).toBe('operation');
  expect(plannedRunApi.start).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: 'operation',
      mode: 'chapter',
      remaining: true,
      autoRevise: false,
    }),
  );
});
it('preserves manual unconfirmed plans instead of automatically approving or overwriting them', async () => {
  state.chapterPlans = [{ ...selection(), confirmed: false }];
  await expect(advanceChapterContinuation('c2', 'operation')).rejects.toThrow('未确认');
  expect(chapterPlanApi.save).not.toHaveBeenCalled();
  expect(plannedRunApi.start).not.toHaveBeenCalled();
});
it('does not regenerate adopted or unadopted prose when every beat exists', async () => {
  state.chapterPlans = [selection()];
  vi.mocked(plannedRunApi.get).mockResolvedValue({
    ready: false,
    runs: [],
    missingBeatIds: [],
    reason: '全部已有采用稿',
  } as unknown as PlannedRunReadiness);
  expect((await advanceChapterContinuation('c2', 'operation')).stage).toBe('done');
  expect(plannedRunApi.start).not.toHaveBeenCalled();
});
it('recovers an existing run after refresh or a lost start response', async () => {
  state.chapterPlans = [selection()];
  vi.mocked(plannedRunApi.get).mockResolvedValue({
    ready: false,
    runs: [{ id: 'operation', status: 'running' }],
  } as PlannedRunReadiness);
  expect((await advanceChapterContinuation('c2', 'operation')).runId).toBe('operation');
  expect(plannedRunApi.start).not.toHaveBeenCalled();
});
it('recovers a saved selection if its HTTP response was lost', async () => {
  state.chapterPlanJobs = [job()];
  vi.mocked(chapterPlanApi.save).mockImplementation(async () => {
    state.chapterPlans = [selection()];
    throw new Error('connection lost');
  });
  expect((await advanceChapterContinuation('c2', 'operation')).stage).toBe('starting');
});
it('does not accept a different selection after a save conflict', async () => {
  state.chapterPlanJobs = [job()];
  vi.mocked(chapterPlanApi.save).mockImplementation(async () => {
    state.chapterPlans = [{ ...selection(), jobId: 'other' }];
    throw new ApiError(409, { code: 'version_mismatch', message: '版本变化' });
  });
  await expect(advanceChapterContinuation('c2', 'operation')).rejects.toThrow('版本变化');
  expect(plannedRunApi.start).not.toHaveBeenCalled();
});
it('requires finalized predecessor material and current planning versions', async () => {
  state.chapterPlanJobs = [{ ...job(), input: { ...job().input, previousChapter: undefined } }];
  await expect(advanceChapterContinuation('c2', 'operation')).rejects.toThrow('上一章尚未定稿');
  state.chapterPlanJobs = [
    { ...job(), request: { ...job().request, expected: { ...versions, outline: 0 } } },
  ];
  await expect(advanceChapterContinuation('c2', 'operation')).rejects.toThrow('生成期间');
  expect(chapterPlanApi.save).not.toHaveBeenCalled();
});
it('shows the specific planning or writing failure rather than silently stopping', async () => {
  state.chapterPlanJobs = [{ ...job('failed'), message: '模型回答达到输出上限' }];
  await expect(advanceChapterContinuation('c2', 'operation')).rejects.toThrow('输出上限');
  state.chapterPlans = [selection()];
  vi.mocked(plannedRunApi.get).mockResolvedValue({
    ready: false,
    runs: [],
    missingBeatIds: ['b'],
    reason: '前章定稿发生变化',
  } as unknown as PlannedRunReadiness);
  await expect(advanceChapterContinuation('c2', 'operation')).rejects.toThrow('前章定稿发生变化');
});

it('recovers duplicate-start busy responses by the persisted operation ID', async () => {
  state.chapterPlans = [selection()];
  vi.mocked(plannedRunApi.start).mockRejectedValue(
    new ApiError(409, { code: 'run_busy', message: '已有运行' }),
  );
  vi.mocked(plannedRunApi.get)
    .mockResolvedValueOnce({
      ready: true,
      runs: [],
      missingBeatIds: ['b'],
      expected: versions,
      planVersion: 1,
    } as unknown as PlannedRunReadiness)
    .mockResolvedValueOnce({
      runs: [{ id: 'operation', status: 'running' }],
    } as PlannedRunReadiness);
  expect((await advanceChapterContinuation('c2', 'operation')).runId).toBe('operation');
});
