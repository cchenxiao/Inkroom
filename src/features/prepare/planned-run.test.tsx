import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import PlannedBeatWriting from './components/PlannedBeatWriting';
import type { PlannedRunRequest } from './api/planned-run';
const { planning } = vi.hoisted(() => ({
  planning: {
    data: {
      input: { version: 1 },
      directionVersion: 1,
      styleVersion: 1,
      coreVersion: 1,
      outlineVersion: 2,
      outlineSelection: { bindingsVersion: 2 },
      chapterPlans: [{ chapterId: 'first', version: 2, confirmed: true }],
    },
    isError: false,
  },
}));
vi.mock('./hooks/usePlanning', () => ({ usePlanning: () => planning }));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('sends planning and draft versions, preserves retry identity, and blocks an obsolete plan', async () => {
  const expected = {
    planning: { input: 1, direction: 1, style: 1, core: 1 },
    outline: 2,
    bindings: 2,
  };
  let planVersion = 2;
  const requests: PlannedRunRequest[] = [];
  server.use(
    http.get('*/go-api/planning/chapter-runs', () =>
      HttpResponse.json({
        ready: true,
        reason: '',
        draftVersion: 0,
        planVersion,
        expected,
        runs: [],
      }),
    ),
    http.post('*/go-api/planning/chapter-runs', async ({ request }) => {
      requests.push((await request.json()) as PlannedRunRequest);
      return HttpResponse.json({ code: 'unavailable', message: '暂时不可用' }, { status: 503 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlannedBeatWriting chapterId="first" editing={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup(),
    start = await screen.findByRole('button', { name: '生成选定 Beat 正文' }, { timeout: 5000 });
  await waitFor(() => expect(start).toBeEnabled());
  await user.click(start);
  await waitFor(() => expect(start).toBeEnabled());
  await user.click(start);
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0]).toMatchObject({
    chapterId: 'first',
    expected,
    planVersion: 2,
    draftVersion: 0,
    autoRevise: false,
  });
  expect(requests[1].requestId).toBe(requests[0].requestId);
  planVersion = 1;
  await user.click(screen.getByRole('button', { name: '刷新写作状态' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '生成选定 Beat 正文' })).toBeDisabled(),
  );
  view.unmount();
  client.clear();
});
