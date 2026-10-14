import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server, resetDB } from '@/mocks/node';
import { seedDocuments } from '@/mocks/data/seed';
import { useUIStore } from '@/shared/lib/ui-store';
import ReviewPage from './index';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  resetDB();
  useUIStore.setState({ chapterId: 'ch7', branchId: 'main', stale: false });
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function passingDocument() {
  const doc = seedDocuments().ch7;
  doc.scores = { items: [], p0Count: 0, canFinalize: true, blockers: [] };
  doc.findings = [];
  doc.conflicts = [];
  doc.patches = [];
  doc.run.status = 'waiting_human';
  return doc;
}
it('disables current approval immediately when another editor marks the version stale', async () => {
  const doc = passingDocument();
  server.use(http.get('*/api/chapters/ch7', () => HttpResponse.json(doc)));
  mount();
  const button = await screen.findByRole('button', { name: '批准当前版本' });
  expect(button).toBeEnabled();
  act(() => useUIStore.getState().setStale(true));
  expect(screen.getByRole('button', { name: '批准当前版本' })).toBeDisabled();
  expect(screen.getByText('稿本已变更，请查看最新差异后重新操作')).toBeInTheDocument();
});
it('submits an approved version to the API only after a live gate passes', async () => {
  const doc = passingDocument();
  let payload: unknown;
  server.use(
    http.get('*/api/chapters/ch7', () => HttpResponse.json(doc)),
    http.post('*/api/runs/:id/actions', async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({ ...doc.run, status: 'completed' });
    }),
  );
  mount();
  await userEvent.click(await screen.findByRole('button', { name: '批准当前版本' }));
  await waitFor(() =>
    expect(payload).toEqual({
      action: 'approve',
      draftVersion: 3,
      chapterId: 'ch7',
      branchId: 'main',
    }),
  );
});
it('keeps approval stale when refreshing the latest manuscript fails', async () => {
  const doc = passingDocument();
  server.use(http.get('*/api/chapters/ch7', () => HttpResponse.json(doc)));
  mount();
  await screen.findByRole('button', { name: '批准当前版本' });
  act(() => useUIStore.getState().setStale(true));
  server.use(
    http.get('*/api/chapters/ch7', () =>
      HttpResponse.json({ code: 'unavailable', message: '暂时无法读取稿本' }, { status: 503 }),
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: '我已查看最新稿本与差异' }));
  await screen.findByRole('alert');
  expect(useUIStore.getState().stale).toBe(true);
});
