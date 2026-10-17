import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import ChapterReview from './components/ChapterReview';
import type { ChapterAssembly } from './api/chapter-assembly';
import type {
  ChapterReviewJob,
  ChapterReviewDecision,
  ChapterReviewRequest,
} from './api/chapter-review';
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
    calls: [
      {
        number: 1,
        role: 'chapter_consistency',
        phase: 'started',
        activity: 'consistency',
        startedAt: new Date(Date.now() - 80000).toISOString(),
        timeoutMs: 90000,
        elapsedMs: 0,
        promptVersion: 'test',
        schemaVersion: 'test',
        usage: { inputTokens: 0, outputTokens: 0, known: false },
      },
    ],
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
  expect(screen.getByRole('region', { name: '检查进度' })).toBeVisible();
  expect(screen.getByText(/已等待 8\d 秒/)).toBeVisible();
  expect(screen.getByRole('checkbox', { name: t.confirm })).toBeDisabled();
  await user.click(screen.getByText('检查设置', { selector: 'summary' }));
  expect(screen.getByRole('checkbox', { name: /加强衔接检查/ })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /加强衔接检查/ })).not.toBeChecked();
  job.status = 'failed';
  job.message = '本轮审稿失败';
  await user.click(screen.getByRole('button', { name: t.refresh }));
  await screen.findByText('本轮审稿失败');
  expect(screen.queryByRole('region', { name: '检查进度' })).not.toBeInTheDocument();
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

it('freezes the chapter review opt-in across an uncertain start and retry', async () => {
  const assembly = {
    id: 'a',
    version: 1,
    digest: 'digest-a',
    createdAt: '2026-10-16',
  } as ChapterAssembly;
  const requests: ChapterReviewRequest[] = [];
  server.use(
    http.get('*/go-api/planning/chapter-reviews', () =>
      HttpResponse.json({ current: true, reason: '', jobs: [] }),
    ),
    http.post('*/go-api/planning/chapter-reviews', async ({ request }) => {
      requests.push((await request.json()) as ChapterReviewRequest);
      return HttpResponse.json({ message: '暂未收到创建回执' }, { status: 503 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterReview assemblies={[assembly]} editing={false} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText('检查设置', { selector: 'summary' }));
  const option = screen.getByRole('checkbox', { name: /加强衔接检查/ });
  expect(option).not.toBeChecked();
  await waitFor(() => expect(screen.getByRole('button', { name: t.start })).toBeEnabled());
  await user.click(option);
  await user.click(screen.getByRole('button', { name: t.start }));
  await user.click(await screen.findByRole('button', { name: t.retry }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(option).toBeDisabled();
  expect(requests[0]).toMatchObject({
    enhancedContinuity: true,
    assemblyId: 'a',
    assemblyVersion: 1,
  });
  expect(requests[1]).toEqual(requests[0]);
  view.unmount();
  client.clear();
});

it('uses the shared workspace choice without adding another switch to chapter review', async () => {
  const assembly = {
    id: 'a',
    version: 1,
    digest: 'digest-a',
    createdAt: '2026-10-16',
  } as ChapterAssembly;
  const requests: ChapterReviewRequest[] = [];
  server.use(
    http.get('*/go-api/planning/chapter-reviews', () =>
      HttpResponse.json({ current: true, reason: '', jobs: [] }),
    ),
    http.post('*/go-api/planning/chapter-reviews', async ({ request }) => {
      requests.push((await request.json()) as ChapterReviewRequest);
      return HttpResponse.json({ message: '暂未收到创建回执' }, { status: 503 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterReview assemblies={[assembly]} editing={false} enhancedContinuity />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('checkbox', { name: /加强衔接检查/ })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: t.start })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: t.start }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].enhancedContinuity).toBe(true);
  view.unmount();
  client.clear();
});
