import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import Reports from './index';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('uses real saved review records without demo scores or experiment actions', async () => {
  server.use(
    http.get('*/go-api/planning/overview', () =>
      HttpResponse.json({
        finalizedChapters: 1,
        doneBeats: 2,
        totalBeats: 2,
        chapters: [
          {
            id: 'chapter',
            number: 1,
            title: '真实章节',
            reason: '已定稿',
            reviewSummary: '作者确认',
          },
        ],
      }),
    ),
    http.get('*/go-api/planning/archive', () =>
      HttpResponse.json({
        scope: 'book/main',
        characters: {},
        initialFacts: [],
        chapters: [
          {
            chapterId: 'chapter',
            publicationId: 'pub',
            number: 1,
            title: '真实章节',
            version: 1,
            current: true,
            facts: [],
            findings: [],
            keptFindings: [],
            statistics: {
              sentenceLengths: [10, 20],
              mean: 15,
              variance: 25,
              burstiness: -0.5,
              calibrated: false,
            },
          },
        ],
      }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/reports', element: <Reports /> }], {
    initialEntries: ['/reports?source=planned&projectId=project-zhuoliu'],
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('15.0 字')).toBeVisible();
  expect(screen.getByRole('link', { name: '导出全部定稿正文' })).toHaveAttribute(
    'href',
    '/go-api/planning/archive?format=text',
  );
  expect(screen.queryByRole('button', { name: /实验|润色/ })).not.toBeInTheDocument();
  expect(screen.getByText(/不作为质量评分或定稿门槛/)).toBeVisible();
  view.unmount();
  client.clear();
});
