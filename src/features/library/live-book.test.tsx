import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import type { LiveBook } from '@/types/domain/live-book';
import { liveBookText as t } from '@/shared/lib/messages-live-book';
import { liveBookKey } from './api/live-book';
import LibraryPage from './LibraryPage';
import { nextBookPath } from './live-book-path';
import BookPage from './BookPage';
const empty: LiveBook = {
  scope: 'zhuoliu/main',
  name: '浊流',
  premise: '',
  genre: '',
  targetWords: '',
  nextSection: 'premise',
  currentChapterId: '',
  nextStage: 'write',
  confirmed: {},
  chapters: [],
  characters: [],
  plans: [],
  style: null,
  acceptedWords: 0,
  finalizedChapters: 0,
  doneBeats: 0,
  totalBeats: 0,
};
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/library', element: <LibraryPage /> },
      { path: '/book/:projectId', element: <BookPage /> },
      { path: '/prepare', element: <p>真实准备入口</p> },
      { path: '/workspace', element: <p>真实写作入口</p> },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    client,
    router,
    close: () => {
      view.unmount();
      client.clear();
    },
  };
}
it('opens the real empty book from the shelf and routes to preparation without demo chapters', async () => {
  server.use(http.get('*/go-api/planning/overview', () => HttpResponse.json(empty)));
  const view = mount('/library');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: t.title }));
  await screen.findByText(t.empty);
  expect(screen.queryByText('夜谈')).not.toBeInTheDocument();
  expect(screen.queryByText('沈砚')).not.toBeInTheDocument();
  await user.click(screen.getAllByRole('link', { name: t.prepare })[0]);
  expect(view.router.state.location.pathname).toBe('/prepare');
  expect(new URLSearchParams(view.router.state.location.search).get('section')).toBe('premise');
  view.close();
});
it('shows backend progress, routes with planning chapter IDs, and never falls back on an API error', async () => {
  let failing = false;
  const data: LiveBook = {
    ...empty,
    acceptedWords: 320,
    doneBeats: 1,
    totalBeats: 2,
    nextSection: '',
    currentChapterId: 'real-chapter',
    chapters: [
      {
        id: 'real-chapter',
        title: '渡口来信',
        act: '开端',
        number: 1,
        targetWords: 3000,
        status: 'drafting',
        reason: '还有一个 Beat 待审核',
        acceptedWords: 320,
        doneBeats: 1,
        totalBeats: 2,
        reviewSummary: '尚无当前整章复审',
        historicalPublication: true,
      },
    ],
  };
  server.use(
    http.get('*/go-api/planning/overview', () =>
      failing
        ? HttpResponse.json({ message: 'offline' }, { status: 503 })
        : HttpResponse.json(data),
    ),
  );
  const view = mount('/book/project-zhuoliu');
  const link = await screen.findByRole('link', { name: t.write });
  expect(link).toHaveAttribute('href', expect.stringContaining('planningChapterId=real-chapter'));
  expect(link).not.toHaveAttribute('href', expect.stringContaining('chapterId=ch7'));
  expect(screen.getByText('320 字')).toBeInTheDocument();
  expect(screen.getByText(t.history)).toBeInTheDocument();
  failing = true;
  await view.client.invalidateQueries({ queryKey: liveBookKey });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t.error));
  expect(screen.queryByText('渡口来信')).not.toBeInTheDocument();
  expect(screen.queryByText('夜谈')).not.toBeInTheDocument();
  view.close();
});

it('continues into the next chapter preparation with its stable chapter ID', () => {
  const path = nextBookPath({
    ...empty,
    currentChapterId: 'chapter-two',
    nextSection: 'outline',
    finalizedChapters: 1,
  });
  const url = new URL(path, 'http://localhost');
  expect(url.pathname).toBe('/prepare');
  expect(url.searchParams.get('planningChapterId')).toBe('chapter-two');
});
