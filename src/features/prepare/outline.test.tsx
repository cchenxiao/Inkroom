import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { useUIStore } from '@/shared/lib/ui-store';
import BackendOutline from './components/BackendOutline';
import type { PlanningState } from './types/planning';
import type {
  OutlineJob,
  OutlineSaveRequest,
  OutlineSelection,
  OutlineStartRequest,
} from './types/outline';
import input from '../../../internal/demo/core_settings.json';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
});
afterAll(() => server.close());
it('keeps chapter IDs and bindings through reordering and requires an explicit versioned confirmation', async () => {
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
  let saves = 0;
  let body: OutlineSaveRequest | undefined;
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(state)),
    http.post('*/go-api/planning/outline-jobs', async ({ request }) => {
      const req = (await request.json()) as OutlineStartRequest;
      const job: OutlineJob = {
        id: req.requestId,
        version: 1,
        status: 'completed',
        request: req,
        input: {
          versions: req.expected,
          source: input.source,
          direction: input.selection,
          style: input.style,
          core: state.coreSelection!,
          request: req.request,
          chapterCount: 2,
        },
        output: {
          acts: [{ id: 'a', title: '合作', purpose: '面对难题' }],
          chapters: [1, 2].map((i) => ({
            id: `ch-${i}`,
            actId: 'a',
            title: `修钟 ${i}`,
            purpose: '接近问题',
            event: '一起寻找答案',
            arc: '放下防备',
            reveal: '合作的可能',
            withhold: '最后的决定',
            characterIds: ['c1'],
            targetWords: 3000,
            storyTime: null,
          })),
          bindings: {
            style: [{ chapterId: 'ch-1', guidance: '留白' }],
            plans: [{ planId: 'p1', chapterIds: ['ch-2'], purpose: '主动求助' }],
          },
        },
        model: 'fake',
        promptVersion: 'story_architect.v1',
        schemaVersion: 'story_architect.v1',
        calls: [],
        message: 'Fake 流程样例',
        createdAt: '2026-10-16T00:00:00Z',
      };
      state = { ...state, outlineJobs: [job] };
      return HttpResponse.json(job, { status: 202 });
    }),
    http.post('*/go-api/planning/outline-selection', async ({ request }) => {
      saves++;
      body = (await request.json()) as OutlineSaveRequest;
      if (saves === 2) {
        state = { ...state, styleVersion: 2 };
        return HttpResponse.json({ code: 'version_mismatch', message: 'stale' }, { status: 409 });
      }
      const saved: OutlineSelection = {
        version: 1,
        bindingsVersion: 1,
        versions: body.expected,
        sourceOutlineVersion: 0,
        jobId: body.jobId,
        candidateVersion: 1,
        content: body.content,
        confirmed: body.confirmed,
        createdAt: '2026-10-16T00:00:00Z',
      };
      state = { ...state, outlineVersion: 1, outlineSelection: saved };
      return HttpResponse.json(saved);
    }),
  );
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BackendOutline />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('本次章纲要求'), '两人一起修钟');
  await user.clear(screen.getByLabelText('建议章数（2–12 章）'));
  await user.type(screen.getByLabelText('建议章数（2–12 章）'), '2');
  await user.click(screen.getByRole('button', { name: '生成章纲候选' }));
  await user.click(await screen.findByRole('button', { name: '编辑这份章纲' }));
  expect(saves).toBe(0);
  const purpose = screen.getByLabelText('本章目的');
  await user.clear(purpose);
  await user.type(purpose, '字'.repeat(201));
  expect(screen.getByRole('alert')).toHaveTextContent('本章目的：内容过长');
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  await user.clear(purpose);
  await user.type(purpose, '接近问题');

  expect(screen.getByRole('button', { name: '确认章纲' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '后移一章' }));
  expect(screen.getByLabelText('章名')).toHaveValue('修钟 1');
  await user.click(screen.getByLabelText('我已核对章纲和章节安排'));
  await user.type(screen.getByLabelText('本章目的'), '，并承担代价');
  expect(screen.getByLabelText('我已核对章纲和章节安排')).not.toBeChecked();
  await user.click(screen.getByLabelText('我已核对章纲和章节安排'));
  await user.click(screen.getByRole('button', { name: '确认章纲' }));
  await waitFor(() => expect(screen.queryByLabelText('章名')).not.toBeInTheDocument());
  expect(body?.content.chapters.map((c) => c.id)).toEqual(['ch-2', 'ch-1']);
  expect(body?.content.bindings.style[0].chapterId).toBe('ch-1');
  expect(body?.content.bindings.plans[0].chapterIds).toEqual(['ch-2']);
  expect(body?.confirmed).toBe(true);
  await user.click(screen.getByRole('button', { name: '编辑 / 复核章纲' }));
  await user.type(screen.getByLabelText('章名'), ' 作者修改');
  await user.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findAllByText(/编辑文字已保留/);
  expect(screen.getByLabelText('章名')).toHaveValue('修钟 2 作者修改');
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  expect(body?.sourceOutlineVersion).toBe(1);
  expect(body?.confirmed).toBe(false);
});
