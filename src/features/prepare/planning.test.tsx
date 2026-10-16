import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import BackendPlanning from './components/BackendPlanning';
import { emptyIntake } from './components/PlanningIntakeForm';
import type { PlanningState, ToneDirection } from './types/planning';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const direction: ToneDirection = {
  title: '选择的代价',
  logline: '两位修钟人合作挽救小店。',
  coreConflict: '手艺与效率冲突。',
  characterDilemma: '信任对方还是坚持自己。',
  readerAppeal: '关系变化推动事件。',
  tone: '对话克制，处境有幽默。',
  narrative: '第三人称限知。',
  tradeoff: '事件规模较小。',
};
function initial(): PlanningState {
  const input = {
    version: 1,
    digest: 'digest-1',
    intake: { ...emptyIntake, premise: '一家面临关闭的修钟店。' },
    effectivePacks: [],
  };
  return {
    input,
    directionVersion: 0,
    selection: null,
    packs: [],
    jobs: [
      {
        id: 'job-1',
        version: 1,
        status: 'completed',
        input,
        model: 'scripted-fake',
        promptVersion: 'tone_director.v1',
        schemaVersion: 'tone_director.v1',
        directions: [direction],
        message: '',
        createdAt: '2026-10-16T00:00:00Z',
        calls: [],
      },
    ],
  };
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BackendPlanning />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it('keeps author edits on 409, disables stale candidate, and never marks it selected', async () => {
  let data = initial();
  let body: unknown;
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(data)),
    http.post('*/go-api/planning/selection', async ({ request }) => {
      body = await request.json();
      data = { ...data, input: { ...data.input, version: 2 } };
      return HttpResponse.json({ code: 'version_mismatch', message: 'changed' }, { status: 409 });
    }),
  );
  const user = setup();
  await user.click(await screen.findByRole('button', { name: /选择的代价/ }));
  const title = screen.getByLabelText('方向名称');
  await user.clear(title);
  await user.type(title, '作者自己的方向');
  await user.click(screen.getByRole('button', { name: '选定这个方向' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '选定这个方向' })).toBeDisabled());
  expect(screen.getByDisplayValue('作者自己的方向')).toBeInTheDocument();
  expect(screen.queryByText(/已选方向/)).not.toBeInTheDocument();
  expect(body).toMatchObject({
    expectedInputVersion: 1,
    expectedDirectionVersion: 0,
    candidateVersion: 1,
    jobId: 'job-1',
    direction: { title: '作者自己的方向' },
  });
});
it('shows a backend error instead of loading mock candidates', async () => {
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json({ message: 'offline' }, { status: 503 })),
  );
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('请启动或重启 Go 后端');
  expect(screen.queryByRole('button', { name: '生成方向候选' })).not.toBeInTheDocument();
});
