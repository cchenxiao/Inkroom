import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PendingWritingProvider, useWritingPending } from '@/shared/lib/pending-writing';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import ChapterPublication from './components/ChapterPublication';
import ChapterAssembly from './components/ChapterAssembly';
import type { ChapterReviewJob } from './api/chapter-review';
import type { ChapterPublicationRequest, ChapterPublicationState } from './api/chapter-publication';
import { chapterPublicationMessages as t } from '@/shared/lib/messages-chapter-publication';

function OtherEdit() {
  const [dirty, setDirty] = useState(false);
  useWritingPending(dirty);
  return (
    <label>
      <input type="checkbox" checked={dirty} onChange={(e) => setDirty(e.target.checked)} />
      其他未保存修改
    </label>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() =>
  server.use(
    http.get('*/go-api/planning/chapter-reviews/:id/facts', () =>
      HttpResponse.json({ job: null, selection: null, current: true, published: false, block: '' }),
    ),
  ),
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('requires fact confirmation and preserves the exact request across uncertain delivery and stale response', async () => {
  const job: ChapterReviewJob = {
    id: 'review',
    current: true,
    approvalBlock: '',
    status: 'completed',
    inputDigest: 'input',
    input: { assemblyId: 'a', draftVersion: 3, assemblyDigest: 'digest-a', parts: [] },
    provider: 'fake',
    model: 'fake',
    calls: [],
    createdAt: '2026-10-16',
    message: '审读完成',
    decision: {
      requestId: 'approval',
      action: 'approve',
      assemblyVersion: 3,
      inputDigest: 'input',
      reason: '已通读',
    },
  };
  let jobs = [job];
  const part = {
    beatId: 'beat',
    sceneTitle: '夜谈',
    beatTitle: '试探',
    commitId: 'commit',
    segments: [],
  };
  const assembly = {
    id: 'a',
    version: 3,
    createdAt: '2026-10-16',
    knowledge: { version: 1 },
    parts: [part],
  };
  const requests: ChapterPublicationRequest[] = [];
  server.use(
    http.post('*/go-api/planning/chapter-assemblies/preview', () =>
      HttpResponse.json({
        ready: true,
        previewDigest: 'preview',
        expectedVersion: 3,
        slots: [
          {
            part,
            choices: [
              { commitId: 'commit', eligible: true, draftVersion: 1, createdAt: '2026-10-16' },
            ],
          },
        ],
        draft: { parts: [part] },
        history: [assembly],
      }),
    ),
    http.get('*/go-api/planning/chapter-reviews', () =>
      HttpResponse.json({ current: true, reason: '', jobs }),
    ),
    http.get('*/go-api/planning/chapter-reviews/review/publication', () =>
      HttpResponse.json({ publication: null, current: false, reason: '' }),
    ),
    http.post('*/go-api/planning/chapter-publications', async ({ request }) => {
      requests.push((await request.json()) as ChapterPublicationRequest);
      return HttpResponse.json(
        { message: requests.length === 1 ? '网络故障' : '版本已更新' },
        { status: requests.length === 1 ? 503 : 409 },
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <PendingWritingProvider>
          <OtherEdit />
          <ChapterAssembly chapterId="chapter" editing={false} />
        </PendingWritingProvider>
      ),
    },
  ]);
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('group', { name: '定稿操作' });
  expect(screen.getByText('已完成的复审 · 意见与作者决定').closest('details')).not.toHaveAttribute(
    'open',
  );
  expect(screen.queryByRole('button', { name: t.publish })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '2 确认定稿' }));
  await screen.findByRole('radio', { name: t.none });
  expect(screen.getByRole('button', { name: t.publish })).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: t.pending }));
  expect(screen.getByRole('button', { name: t.publish })).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: t.none }));
  await user.click(screen.getByRole('checkbox', { name: '其他未保存修改' }));
  expect(screen.getByRole('button', { name: t.publish })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: '其他未保存修改' }));
  expect(screen.getByRole('button', { name: t.publish })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: t.publish }));
  await screen.findByRole('button', { name: t.retry });
  expect(screen.getByRole('combobox', { name: '夜谈 · 试探' })).toBeDisabled();
  jobs = [
    { ...job, id: 'external-review', status: 'running' },
    { ...job, current: false },
  ];
  await client.invalidateQueries({ queryKey: ['chapter-review', 'a'] });
  await user.click(screen.getByRole('button', { name: t.retry }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({
    reviewId: 'review',
    assemblyVersion: 3,
    approvalId: 'approval',
    inputDigest: 'input',
    noPendingFacts: true,
  });
  await waitFor(() => expect(screen.getByRole('radio', { name: t.none })).not.toBeChecked());
  expect(screen.getByRole('button', { name: t.publish })).toBeDisabled();
  view.unmount();
  client.clear();
});
it('shows a saved publication after reload and distinguishes history from a current final chapter', async () => {
  const job = {
    id: 'review',
    current: true,
    approvalBlock: '',
    status: 'completed',
    inputDigest: 'input',
    input: { assemblyId: 'a', draftVersion: 3 },
    decision: { requestId: 'approval', action: 'approve' },
  } as ChapterReviewJob;
  const receipt = {
    current: true,
    reason: '',
    publication: {
      id: 'pub',
      version: 1,
      createdAt: '2026-10-16T00:00:00Z',
      request: { requestId: 'pub' },
      assembly: { version: 3 },
      factConfirmation: { noPendingFacts: true },
    },
  } as ChapterPublicationState;
  server.use(
    http.get('*/go-api/planning/chapter-reviews/review/publication', () =>
      HttpResponse.json(receipt),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterPublication job={job} blocked={false} />
    </QueryClientProvider>,
  );
  await screen.findByText(t.saved);
  expect(screen.queryByRole('button', { name: t.publish })).not.toBeInTheDocument();
  receipt.current = false;
  receipt.reason = '来源已更版';
  await client.invalidateQueries({ queryKey: ['chapter-publication', 'review'] });
  await screen.findByText(t.historical);
  expect(screen.getByText('来源已更版')).toBeInTheDocument();
  view.unmount();
  client.clear();
});
