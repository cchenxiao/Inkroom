// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { server, resetDB } from '@/mocks/node';
import type {
  BookOverview,
  BookPlan,
  BookSummary,
  PlanAction,
  PlanStep,
} from '@/types/domain/library';
import type { ChapterDocument } from '@/types/domain';
const call = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  fetch(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const overview = async (id: string) =>
  (await call(`/projects/${id}/overview`)).json() as Promise<BookOverview>;
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => resetDB());
afterAll(() => server.close());
describe('作品层确认和隔离', () => {
  it('不同作品不能读写浊流，未接线的 Agent 请求不会穿透旧处理器', async () => {
    const library: BookSummary[] = await (await call('/projects')).json();
    expect(library).toHaveLength(3);
    const original = await (await call('/chapters/ch7')).json();
    expect((await call('/chapters/ch7?projectId=project-clock')).status).toBe(404);
    expect(
      (
        await call(
          '/segments/ch7-s1?projectId=project-clock',
          { text: '不能串书', draftVersion: 3 },
          'PATCH',
        )
      ).status,
    ).toBe(404);
    expect((await call('/runs?projectId=project-clock', { chapterId: 'ch7' })).status).toBe(501);
    expect((await call('/projects/missing/overview')).status).toBe(404);
    expect(await (await call('/chapters/ch7')).json()).toEqual(original);
  });
  it('保存草稿可恢复，只有逐步锁定的候选公开，上游改变后下游失效', async () => {
    let plan: BookPlan = await (
      await call('/projects', {
        name: '测试作品',
        logline: '守夜人寻找一封迟到的信',
        genre: '悬疑',
        targetWords: 48000,
      })
    ).json();
    const id = plan.projectId;
    const act = async (action: PlanAction) => {
      const res = await call(
        `/projects/${id}/planning`,
        { expectedVersion: plan.version, ...action },
        'PATCH',
      );
      expect(res.status, JSON.stringify(action)).toBe(200);
      plan = await res.json();
    };
    for (const step of [0, 1, 2, 3] as PlanStep[]) {
      await act({ action: 'generate', step });
      await act({ action: 'select', step, candidateId: plan.steps[step].candidates[0].id });
      if (step === 2) {
        const candidate = plan.steps[step].candidates[0];
        expect((await overview(id)).bible.characters).toEqual([]);
        if (candidate.content.kind !== 'world') throw new Error('expected world');
        candidate.content.characters.forEach((c) => (c.confirmed = true));
        candidate.content.rules.forEach((r) => (r.confirmed = true));
        await act({ action: 'edit', step, candidateId: candidate.id, content: candidate.content });
      }
      await act({ action: 'lock', step });
    }
    expect(await (await call(`/projects/${id}/planning`)).json()).toEqual(plan);
    const ready = await overview(id);
    expect(ready.confirmed.outline).toBe(true);
    expect(ready.bible.characters.length).toBeGreaterThan(0);
    expect(ready.chapters[0].scenes.length).toBeGreaterThan(0);
    expect(ready.chapters.slice(1).every((c) => c.scenes.length === 0)).toBe(true);
    await act({ action: 'unlock', step: 3 });
    const outline = plan.steps[3].candidates[0];
    if (outline.content.kind !== 'outline') throw new Error('expected outline');
    outline.content.chapters[0].scenes[0].title = '作者重写的场景目标';
    await act({ action: 'edit', step: 3, candidateId: outline.id, content: outline.content });
    await act({ action: 'lock', step: 3 });
    expect((await overview(id)).chapters[0].scenes[0].title).toBe('作者重写的场景目标');
    const version = plan.version;
    await act({ action: 'unlock', step: 0 });
    expect(plan.steps.every((s) => !s.locked)).toBe(true);
    const pending = await overview(id);
    expect(pending.chapters).toEqual([]);
    expect(pending.bible.characters).toEqual([]);
    expect(
      (
        await call(
          `/projects/${id}/planning`,
          { expectedVersion: version, action: 'lock', step: 0 },
          'PATCH',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          `/projects/${id}/planning`,
          { expectedVersion: plan.version, action: 'lock', step: 3 },
          'PATCH',
        )
      ).status,
    ).toBe(422);
  });
  it('新书试写分支独立保存并拒绝旧版本，章节定位属于当前书', async () => {
    const book = await overview('project-clock');
    const id = book.project.currentChapterId;
    const read = async (branch = 'main'): Promise<ChapterDocument> =>
      (await call(`/chapters/${id}?projectId=project-clock&branchId=${branch}`)).json();
    const main = await read();
    expect(main.chapter.scenes[0].id).toBe(main.segments[0].sceneId);
    const branch = await (
      await call('/branches?projectId=project-clock', { name: '试写', fromBranchId: 'main' })
    ).json();
    const path = `/segments/${main.segments[0].id}?projectId=project-clock&branchId=${branch.id}`;
    expect(
      (await call(path, { draftVersion: main.chapter.draftVersion, text: '新分支的开场' }, 'PATCH'))
        .status,
    ).toBe(200);
    expect(
      (await call(path, { draftVersion: main.chapter.draftVersion, text: '迟到结果' }, 'PATCH'))
        .status,
    ).toBe(409);
    expect((await read()).segments).toEqual(main.segments);
    expect((await read(branch.id)).segments[0].text).toBe('新分支的开场');
    expect((await read(branch.id)).scores.canFinalize).toBe(false);
  });
});
