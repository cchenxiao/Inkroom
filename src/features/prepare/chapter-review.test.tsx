import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import ChapterReview from './components/ChapterReview';
import type { ChapterAssembly } from './api/chapter-assembly';
import type { ChapterReviewJob, ChapterReviewDecision } from './api/chapter-review';
import { chapterReviewMessages as t } from '@/shared/lib/messages-chapter-review';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('blocks failed critics and invalidates author confirmation on stale-version response while retaining retry identity', async () => {
  const assembly = {
    id: 'a',
    version: 1,
    digest: 'digest-a',
    createdAt: '2026-10-16',
  } as ChapterAssembly;
  const job: ChapterReviewJob = {
    id: 'review',
    status: 'running',
    provider: 'fake',
    model: 'scripted-fake',
    inputDigest: 'input-digest',
    input: { assemblyId: 'a', draftVersion: 1, assemblyDigest: 'digest-a', parts: [] },
    message: '本轮审稿中',
    current: true,
    approvalBlock: '两路整章复审尚未完整完成',
    createdAt: '2026-10-16',
    calls: [],
  };
  const requests: ChapterReviewDecision[] = [];
  server.use(
    http.get('*/go-api/planning/chapter-reviews', () =>
      HttpResponse.json({ current: job.current, reason: '', jobs: [job] }),
    ),
    http.post('*/go-api/planning/chapter-reviews/review/decisions', async ({ request }) => {
      requests.push((await request.json()) as ChapterReviewDecision);
      if (requests.length === 1) return HttpResponse.json({ message: '网络故障' }, { status: 503 });
      job.current = false;
      job.approvalBlock = t.sourceChanged;
      return HttpResponse.json({ message: t.sourceChanged }, { status: 409 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterReview assemblies={[assembly]} editing={false} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText('本轮审稿中');
  expect(screen.getByRole('checkbox', { name: t.confirm })).toBeDisabled();
  job.status = 'failed';
  job.message = '本轮审稿失败';
  await user.click(screen.getByRole('button', { name: t.refresh }));
  await screen.findByText('本轮审稿失败');
  await user.type(screen.getByRole('textbox', { name: t.reason }), '已通读并核对两段之间的动作');
  await user.click(screen.getByRole('checkbox', { name: t.confirm }));
  expect(screen.getByRole('button', { name: t.approve })).toBeDisabled();
  job.status = 'completed';
  job.approvalBlock = '';
  job.output = {
    critics: [
      { critic: 'hard_consistency', status: 'completed', findings: [] },
      { critic: 'ai_taste', status: 'completed', findings: [] },
    ],
  };
  await user.click(screen.getByRole('button', { name: t.refresh }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: t.confirm })).not.toBeChecked());
  await user.click(screen.getByRole('checkbox', { name: t.confirm }));
  await waitFor(() => expect(screen.getByRole('button', { name: t.approve })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: t.approve }));
  await user.click(await screen.findByRole('button', { name: t.retry }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: t.confirm })).not.toBeChecked());
  expect(screen.getByRole('button', { name: t.approve })).toBeDisabled();
  expect(requests[0]).toMatchObject({
    assemblyVersion: 1,
    inputDigest: 'input-digest',
    action: 'approve',
  });
  view.unmount();
  client.clear();
});
