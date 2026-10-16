import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { useUIStore } from '@/shared/lib/ui-store';
import BackendCoreSettings from './components/BackendCoreSettings';
import type { PlanningState } from './types/planning';
import type { CoreJob, CoreSaveRequest, CoreStartRequest } from './types/core-settings';
import input from '../../../internal/demo/core_settings.json';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
});
afterAll(() => server.close());
function fixture(): PlanningState {
  return {
    input: input.source,
    selection: input.selection,
    directionVersion: 1,
    styleSelection: input.style,
    styleVersion: 1,
    jobs: [],
    packs: [],
    styleJobs: [],
    coreJobs: [],
    coreSelection: null,
    coreVersion: 0,
  };
}
function setup() {
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BackendCoreSettings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
it('generates candidates, requires explicit dependencies and preserves edits after a stale save', async () => {
  let state = fixture();
  let body: CoreSaveRequest | undefined;
  let submissions = 0;
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(state)),
    http.post('*/go-api/planning/core-jobs', async ({ request }) => {
      const req = (await request.json()) as CoreStartRequest;
      const job: CoreJob = {
        id: req.requestId,
        version: 1,
        status: 'completed',
        request: req,
        input,
        model: 'fake',
        promptVersion: 'core_planner.v1',
        schemaVersion: 'core_planner.v1',
        calls: [],
        message: 'Fake 流程样例',
        createdAt: '2026-10-16T00:00:00Z',
        output: {
          characters: [
            {
              id: 'c1',
              name: '林舟',
              role: '主角',
              want: '修好钟',
              need: '接受帮助',
              flaw: '固执',
              arcIntent: '从独自承担走向合作',
              voice: ['简短'],
              hardFactIds: ['f1'],
            },
          ],
          worldFacts: [
            {
              id: 'f1',
              subject: 'c1',
              text: '林舟惯用左手',
              rigidity: 'hard',
              storyTime: null,
              knownBy: [],
            },
          ],
          plans: [{ id: 'p1', subject: 'c1', intent: '后续选择求助' }],
        },
      };
      state = { ...state, coreJobs: [job] };
      return HttpResponse.json(job, { status: 202 });
    }),
    http.post('*/go-api/planning/core-selection', async ({ request }) => {
      submissions++;
      body = (await request.json()) as CoreSaveRequest;
      if (submissions === 2) {
        state = { ...state, styleVersion: 2 };
        return HttpResponse.json({ code: 'version_mismatch', message: 'stale' }, { status: 409 });
      }
      const saved = {
        version: 1,
        inputVersion: 1,
        directionVersion: 1,
        styleVersion: 1,
        sourceCoreVersion: 0,
        jobId: body.jobId,
        candidateVersion: body.candidateVersion,
        content: body.content,
        decisions: body.decisions,
        createdAt: '2026-10-16T00:00:00Z',
      };
      state = { ...state, coreVersion: 1, coreSelection: saved };
      return HttpResponse.json(saved);
    }),
  );
  const user = setup();
  await user.type(await screen.findByLabelText('本次补齐范围'), '主角和必要事实');
  await user.click(screen.getByRole('button', { name: '生成设定候选' }));
  await user.click(await screen.findByRole('button', { name: '编辑这组候选' }));
  expect(submissions).toBe(0);
  expect(screen.getByLabelText('林舟 · 状态')).toHaveValue('pending');
  await user.selectOptions(screen.getByLabelText('林舟 · 状态'), 'confirmed');
  expect(screen.getByRole('button', { name: '保存本次核对' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('世界事实提案 1 · 状态'), 'confirmed');
  await user.selectOptions(screen.getByLabelText('未来计划 1 · 状态'), 'rejected');
  await user.click(screen.getByRole('button', { name: '保存本次核对' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: '逐条核对设定' })).not.toBeInTheDocument(),
  );
  expect(body?.decisions).toEqual({ c1: 'confirmed', f1: 'confirmed', p1: 'rejected' });
  expect(body?.content.worldFacts[0].knownBy).toEqual([]);
  await user.click(screen.getByRole('button', { name: '编辑 / 复核已保存设定' }));
  const name = screen.getByLabelText('姓名');
  await user.clear(name);
  await user.type(name, '作者的新姓名');
  expect(screen.getByLabelText('作者的新姓名 · 状态')).toHaveValue('pending');
  await user.selectOptions(screen.getByLabelText('作者的新姓名 · 状态'), 'confirmed');
  await user.click(screen.getByRole('button', { name: '保存本次核对' }));
  await screen.findAllByText(/当前编辑不可保存/);
  expect(screen.getByLabelText('姓名')).toHaveValue('作者的新姓名');
  expect(screen.getByRole('button', { name: '保存本次核对' })).toBeDisabled();
  expect(body?.sourceCoreVersion).toBe(1);
});
