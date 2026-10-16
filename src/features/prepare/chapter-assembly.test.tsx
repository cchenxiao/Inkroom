import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import ChapterAssembly from './components/ChapterAssembly';
import { assemblyMessages as t } from '@/shared/lib/messages-assembly';
import type { AssemblySaveRequest } from './api/chapter-assembly';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('requires author confirmation, reuses uncertain requests, and invalidates a stale preview', async () => {
  const part = {
    sceneId: 's',
    sceneTitle: '门前',
    beatId: 'b',
    beatTitle: '敲门',
    commitId: 'commit-a',
    draftVersion: 2,
    segments: [{ id: 's1', version: 2, text: '她抬起手，又放下。' }],
  };
  let digest = 'first';
  let attempts = 0;
  const requests: AssemblySaveRequest[] = [];
  server.use(
    http.post('*/go-api/planning/chapter-assemblies/preview', () =>
      HttpResponse.json({
        ready: true,
        reason: '',
        expectedVersion: 0,
        previewDigest: digest,
        slots: [
          {
            part,
            reason: '',
            choices: [
              {
                commitId: 'commit-a',
                draftVersion: 2,
                createdAt: '2026-10-16',
                eligible: true,
                reason: '',
              },
            ],
          },
        ],
        draft: { parts: [part] },
        history: [],
      }),
    ),
    http.post('*/go-api/planning/chapter-assemblies', async ({ request }) => {
      requests.push((await request.json()) as AssemblySaveRequest);
      attempts++;
      if (attempts === 1) return HttpResponse.json({ message: '暂时不可用' }, { status: 503 });
      digest = 'changed';
      return HttpResponse.json({ message: '版本已变化' }, { status: 409 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterAssembly chapterId="first" editing={false} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText(part.segments[0].text);
  const selectedOption = screen.getByRole('option', { name: /候选 v2/ });
  expect(selectedOption).not.toHaveTextContent('commit-a');
  expect(selectedOption).toHaveAttribute('value', 'commit-a');
  const save = () => screen.getByRole('button', { name: t.save });
  expect(save()).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: t.confirm }));
  await waitFor(() => expect(save()).toBeEnabled());
  await user.click(save());
  await user.click(await screen.findByRole('button', { name: t.retry }));
  await screen.findByText(t.stale);
  await waitFor(() => expect(save()).toBeDisabled());
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({
    chapterId: 'first',
    choices: { b: 'commit-a' },
    expectedVersion: 0,
    previewDigest: 'first',
    confirm: true,
  });
  expect(screen.getByRole('checkbox', { name: t.confirm })).not.toBeChecked();
  view.unmount();
  client.clear();
});

it('keeps embedded work focused on missing segments and preserves confirmation across steps', async () => {
  let ready = false;
  const part = {
    sceneTitle: '门前',
    beatTitle: '敲门',
    beatId: 'b',
    commitId: 'commit-a',
    draftVersion: 2,
    segments: [{ id: 's1', version: 2, text: '她抬起手。' }],
  };
  server.use(
    http.post('*/go-api/planning/chapter-assemblies/preview', () =>
      HttpResponse.json({
        ready,
        reason: ready ? '' : '请先审核正文',
        expectedVersion: 0,
        previewDigest: 'digest',
        slots: [
          {
            part,
            reason: ready ? '' : '尚未审核',
            choices: [
              { commitId: 'commit-a', draftVersion: 2, createdAt: '2026-10-16', eligible: true },
            ],
          },
        ],
        draft: { parts: [part] },
        history: [],
      }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const review = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterAssembly chapterId="first" editing={false} embedded onReviewBeat={review} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '去审核这一段' }));
  expect(review).toHaveBeenCalledWith('b');
  expect(screen.queryByRole('button', { name: t.save })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox')).not.toBeVisible();
  ready = true;
  await user.click(screen.getByRole('button', { name: t.refresh }));
  await user.click(await screen.findByRole('checkbox', { name: t.confirm }));
  await user.click(screen.getByRole('button', { name: '历史版本' }));
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '整理章稿' }));
  expect(screen.getByRole('checkbox', { name: t.confirm })).toBeChecked();
  view.unmount();
  client.clear();
});
