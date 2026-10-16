import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { useUIStore } from '@/shared/lib/ui-store';
import BackendChapterPlan from './components/BackendChapterPlan';
import type { PlanningState } from './types/planning';
import type {
  ChapterPlanJob,
  ChapterPlanSaveRequest,
  ChapterPlanSelection,
  ChapterPlanStartRequest,
} from './types/chapter-plan';
import input from '../../../internal/demo/core_settings.json';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
});
afterAll(() => server.close());
it('requires explicit chapter plan confirmation and retains edits on version conflict', async () => {
  let state: PlanningState = {
    input: input.source,
    selection: input.selection,
    directionVersion: 1,
    styleSelection: input.style,
    styleVersion: 1,
    jobs: [],
    packs: [],
    styleJobs: [],
    coreJobs: [],
    coreVersion: 1,
    coreSelection: {
      version: 1,
      inputVersion: 1,
      directionVersion: 1,
      styleVersion: 1,
      sourceCoreVersion: 0,
      jobId: 'core',
      candidateVersion: 1,
      content: {
        characters: [
          {
            id: 'c1',
            name: '林舟',
            role: '主角',
            want: '修钟',
            need: '合作',
            flaw: '固执',
            arcIntent: '接受帮助',
            voice: ['简短'],
            hardFactIds: [],
          },
        ],
        worldFacts: [],
        plans: [{ id: 'p1', subject: 'c1', intent: '尝试主动求助' }],
      },
      decisions: { c1: 'confirmed', p1: 'confirmed' },
      createdAt: '2026-10-16T00:00:00Z',
    },
    outlineJobs: [],
    outlineVersion: 0,
    outlineSelection: null,
  };

  state.outlineVersion = 1;
  state.chapterPlans = [];
  state.chapterPlanJobs = [];
  state.outlineSelection = {
    version: 1,
    bindingsVersion: 1,
    versions: { input: 1, direction: 1, style: 1, core: 1 },
    sourceOutlineVersion: 0,
    jobId: 'outline',
    candidateVersion: 1,
    confirmed: true,
    createdAt: '2026-10-16T00:00:00Z',
    content: {
      acts: [{ id: 'a', title: '合作', purpose: '面对难题' }],
      chapters: [1, 2].map((i) => ({
        id: `ch-${i}`,
        actId: 'a',
        title: `修钟 ${i}`,
        purpose: '共同修钟',
        event: '提出问题',
        arc: '学会合作',
        reveal: '线索',
        withhold: '答案',
        characterIds: ['c1'],
        targetWords: 3000,
        storyTime: null,
      })),
      bindings: { style: [], plans: [] },
    },
  };
  let saves = 0;
  let body: ChapterPlanSaveRequest | undefined;
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(state)),
    http.post('*/go-api/planning/chapter-plan-jobs', async ({ request }) => {
      const req = (await request.json()) as ChapterPlanStartRequest;
      const job: ChapterPlanJob = {
        id: req.requestId,
        version: 1,
        status: 'completed',
        request: req,
        input: {
          base: {
            versions: req.expected.planning,
            source: input.source,
            direction: input.selection,
            style: input.style,
            core: state.coreSelection!,
            request: req.request,
            chapterCount: 2,
          },
          outline: state.outlineSelection!,
          chapterId: req.chapterId,
          request: req.request,
        },
        output: {
          scenes: [
            {
              id: 's1',
              title: '钟楼的试探',
              goal: '找到故障',
              conflict: '对方隐瞒线索',
              outcome: '决定合作',
              povCharacterId: 'c1',
              characterIds: ['c1'],
              storyTime: null,
              beats: [
                { id: 'b1', title: '提问', action: '追问旧钟', turn: '对方回避' },
                { id: 'b2', title: '观察', action: '停下来听', turn: '发现异常' },
              ],
            },
          ],
          brief: {
            selectedBeatId: 'b1',
            mustHappen: '找到线索',
            cannotChange: '保持人物硬约束',
            reveal: '新的异常',
            withhold: '真凶',
            writingGuidance: '动作承载情绪',
          },
        },
        model: 'fake',
        promptVersion: 'showrunner.v1',
        schemaVersion: 'showrunner.v1',
        calls: [],
        message: 'Fake 流程样例',
        createdAt: '2026-10-16T00:00:00Z',
      };
      state = { ...state, chapterPlanJobs: [job] };
      return HttpResponse.json(job, { status: 202 });
    }),
    http.post('*/go-api/planning/chapter-plan-selection', async ({ request }) => {
      saves++;
      body = (await request.json()) as ChapterPlanSaveRequest;
      if (saves === 2) {
        state = { ...state, outlineVersion: 2 };
        return HttpResponse.json({ code: 'version_mismatch', message: 'stale' }, { status: 409 });
      }
      const saved: ChapterPlanSelection = {
        version: 1,
        versions: body.expected,
        chapterId: body.chapterId,
        sourceVersion: 0,
        jobId: body.jobId,
        candidateVersion: 1,
        input: state.chapterPlanJobs![0].input,
        content: body.content,
        knowledge: [],
        confirmed: body.confirmed,
        createdAt: '2026-10-16T00:00:00Z',
      };
      state = { ...state, chapterPlans: [saved] };
      return HttpResponse.json(saved);
    }),
  );
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BackendChapterPlan />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('本章展开要求'), '从试探开始');
  await user.click(screen.getByRole('button', { name: '生成本章细纲候选' }));
  await user.click(await screen.findByRole('button', { name: '查看并编辑候选' }));
  expect(saves).toBe(0);
  expect(screen.getByLabelText('展开章节')).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认规划' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('后续单段写作先用哪个 Beat'), 'b2');
  await user.click(screen.getByLabelText('我已核对本章细纲与 Brief'));
  await user.type(screen.getByLabelText('本场目标'), '，试着合作');
  expect(screen.getByLabelText('我已核对本章细纲与 Brief')).not.toBeChecked();
  await user.click(screen.getByLabelText('我已核对本章细纲与 Brief'));
  await user.click(screen.getByRole('button', { name: '确认规划' }));
  await waitFor(() => expect(screen.queryByLabelText('场景标题')).not.toBeInTheDocument());
  expect(body?.content.brief.selectedBeatId).toBe('b2');
  expect(body?.expected.outline).toBe(1);
  expect(body?.confirmed).toBe(true);
  await user.click(screen.getByRole('button', { name: '编辑 / 复核' }));
  await user.type(screen.getByLabelText('场景标题'), ' 作者改稿');
  await user.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findAllByText(/本地编辑仍保留/);
  expect(screen.getByLabelText('场景标题')).toHaveValue('钟楼的试探 作者改稿');
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  expect(body?.sourceVersion).toBe(1);
});
