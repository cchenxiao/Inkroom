import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import Reports from './index';
vi.mock('@/shared/ui', async (original) => ({
  ...(await original<typeof import('@/shared/ui')>()),
  Chart: ({ option }: { option: unknown }) => (
    <div data-testid="chart">{JSON.stringify(option)}</div>
  ),
}));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('uses the original dashboard with real charts, evidence, chapter actions and no demo scores', async () => {
  server.use(
    http.get('*/go-api/planning/quality', () =>
      HttpResponse.json({
        scope: 'book/main',
        runs: [],
        chapters: [
          {
            chapterId: 'chapter',
            title: '真实章节',
            words: 30,
            statistics: { sentenceLengths: [10, 20], mean: 15, variance: 25 },
            findings: [
              {
                id: 'f',
                critic: 'ai_taste',
                severity: 'P3',
                quote: '真实引用',
                reason: '真实检查说明',
                beatId: 'b',
                runId: 'r',
                kept: true,
              },
            ],
          },
        ],
      }),
    ),
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
            status: 'finalized',
            targetWords: 600,
            totalBeats: 2,
            doneBeats: 2,
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
            findings: [{ id: 'old', critic: 'ai_taste', quote: '历史原文', reason: '历史审查' }],
            keptFindings: null,
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
  expect(await screen.findByRole('heading', { name: '章节状态与结构' })).toBeVisible();
  expect(screen.getByRole('link', { name: '导出定稿正文' })).toHaveAttribute(
    'href',
    '/go-api/planning/archive?format=text',
  );
  await userEvent.click(screen.getByRole('tab', { name: '风格趋势' }));
  const charts = await screen.findAllByTestId('chart');
  const trend = JSON.parse(charts[0].textContent!);
  expect(trend.series[0].name).toBe('平均句长');
  expect(trend.series[0].data).toEqual([15]);
  expect(trend.series[1].data).toEqual([5]);
  await userEvent.click(screen.getByRole('tab', { name: 'AI味热区' }));
  await userEvent.click(screen.getByRole('button', { name: '查看证据' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('真实引用');
  await userEvent.click(screen.getByRole('button', { name: '在正文处理此问题' }));
  expect(router.state.location.search).toContain('beatId=b');
  view.unmount();
  client.clear();
});
