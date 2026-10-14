import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server, resetDB } from '@/mocks/node';
import { handConflict } from '@/mocks/data/seed';
import { useUIStore } from '@/shared/lib/ui-store';
import ChangesPage from './index';
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
        <ChangesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('requires a human choice and reason, then preserves the dialogue lie choice in the API request', async () => {
  let payload: unknown;
  server.use(
    http.get('*/api/conflicts', () => HttpResponse.json([handConflict])),
    http.post('*/api/conflicts/:id/resolve', async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({ ...handConflict, status: 'resolved' });
    }),
  );
  mount();
  const resolve = await screen.findByRole('button', { name: '确认裁决' });
  expect(resolve).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '以正文为准' }));
  expect(resolve).toBeDisabled();
  await userEvent.click(
    screen.getByRole('checkbox', { name: '这是台词谎言或人物误解，不更新世界事实' }),
  );
  await userEvent.type(screen.getByRole('textbox', { name: '说明判断依据' }), '角色故意隐瞒');
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  await waitFor(() =>
    expect(payload).toEqual({
      choice: 'manuscript',
      isDialogueLie: true,
      reason: '角色故意隐瞒',
      draftVersion: 3,
      branchId: 'main',
      chapterId: 'ch7',
    }),
  );
});
