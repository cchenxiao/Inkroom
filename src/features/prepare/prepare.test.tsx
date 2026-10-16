import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server, resetDB } from '@/mocks/node';
import { useUIStore } from '@/shared/lib/ui-store';
import PreparePage from './index';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  server.use(
    http.get('*/go-api/planning', () =>
      HttpResponse.json({ message: 'not running' }, { status: 503 }),
    ),
  );
  resetDB();
  useUIStore.setState({ chapterId: 'ch7', branchId: 'main', stale: false });
});
it('shows generated suggestions as an unapplied preview before author confirmation', async () => {
  let writes = 0;
  let payload: unknown;
  server.use(
    http.post('*/api/projects/:id/suggestions', async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({
        id: 'suggest-project',
        origin: 'agent',
        targetType: 'project',
        targetId: 'project-zhuoliu',
        old: { logline: 'old' },
        new: { logline: 'candidate' },
        reason: '候选方向',
        blastRadius: [],
        conflicts: [],
        parentCommit: 'c3',
        draftVersion: 3,
        status: 'preview',
        createdAt: new Date().toISOString(),
      });
    }),
    http.post('*/api/changesets/:id/apply', () => {
      writes++;
      return HttpResponse.json({});
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PreparePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue('浊流');
  expect(screen.queryByRole('heading', { name: '人物、世界与风格' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /风格/ }));
  expect(screen.queryByDisplayValue('浊流')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /立意/ }));
  expect(screen.getByDisplayValue('浊流')).toBeInTheDocument();
  await userEvent.click(screen.getByText('演示项目设定（Mock，与上方规划独立）'));
  await userEvent.click(screen.getByRole('button', { name: '生成候选建议' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: '生成候选建议' }));
  await screen.findByRole('heading', { name: '确认设定影响' });
  expect(writes).toBe(0);
  expect(payload).toEqual({ kind: 'project', draftVersion: 3, chapterId: 'ch7', branchId: 'main' });
  await userEvent.click(screen.getByRole('button', { name: '仅标记待复核' }));
  await waitFor(() => expect(writes).toBe(1));
});
