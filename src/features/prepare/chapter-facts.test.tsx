import { beforeAll, afterEach, afterAll, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { PendingWritingProvider } from '@/shared/lib/pending-writing';
import { chapterFactsMessages as t } from '@/shared/lib/messages-chapter-facts';
import { chapterPublicationMessages as p } from '@/shared/lib/messages-chapter-publication';
import ChapterPublication from './components/ChapterPublication';
import type { ChapterReviewJob } from './api/chapter-review';
import type { FactsJob, FactsState, FactsSelectionRequest } from './api/chapter-facts';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it.each(['publish', 'remote publication'])(
  'retains author fact edits and version binding: %s',
  async (scenario) => {
    const review = {
      id: 'review',
      current: true,
      status: 'completed',
      approvalBlock: '',
      inputDigest: 'digest',
      input: {
        assemblyId: 'a',
        draftVersion: 1,
        assemblyDigest: 'assembly',
        parts: [
          {
            beatId: 'beat',
            sceneId: 'scene',
            title: '交接',
            commitId: 'commit',
            pov: 'shen',
            storyTime: 10,
            segments: [
              {
                id: 's1',
                kind: 'passage',
                text: '陆青把铜扣交给沈砚。',
                sourceId: 'seg',
                sourceVersion: 1,
              },
            ],
            facts: [],
          },
        ],
      },
      decision: {
        requestId: 'approve',
        assemblyVersion: 1,
        inputDigest: 'digest',
        action: 'approve',
        reason: '通过',
      },
      provider: 'fake',
      model: 'fake',
      calls: [],
      createdAt: '2026-10-16',
      message: '',
    } as ChapterReviewJob;
    const job: FactsJob = {
      id: 'facts',
      request: { requestId: 'facts', reviewId: 'review', inputDigest: 'digest', mode: 'manual' },
      status: 'completed',
      provider: 'human',
      model: '',
      message: '请按原文整理',
      createdAt: '2026-10-16',
      input: {
        chapterId: 'chapter',
        review: review.input,
        baseKnowledge: { version: 1, digest: 'knowledge' },
        knowledge: { characters: ['shen', 'lu'], facts: [] },
      },
      output: { candidates: [] },
      calls: [],
    };
    const state: FactsState = {
      job:
        scenario === 'publish'
          ? {
              ...job,
              status: 'failed',
              output: undefined,
              message: '提取失败',
              failure: {
                stage: 'validation',
                code: 'evidence_mismatch',
                message: '候选引文与本次章稿不一致，未载入候选。',
              },
            }
          : null,
      selection: null,
      current: true,
      published: false,
      block: '',
    };
    let readFails = false;
    let receipt: Record<string, unknown> | null = null;
    const writes: FactsSelectionRequest[] = [];
    const publications: Record<string, unknown>[] = [];
    server.use(
      http.get('*/go-api/planning/chapter-reviews/review/publication', () =>
        HttpResponse.json({ publication: receipt, current: !!receipt, reason: '' }),
      ),
      http.get('*/go-api/planning/chapter-reviews/review/facts', () =>
        readFails
          ? HttpResponse.json({ message: 'offline' }, { status: 503 })
          : HttpResponse.json(state),
      ),
      http.post('*/go-api/planning/chapter-fact-jobs', () => {
        state.job = job;
        state.block = '请保存逐条决定';
        return HttpResponse.json(job);
      }),
      http.post('*/go-api/planning/chapter-fact-selections', async ({ request }) => {
        const req = (await request.json()) as FactsSelectionRequest;
        writes.push(req);
        if (writes.length === 1) return HttpResponse.json({ message: 'unknown' }, { status: 503 });
        state.block = '';
        state.selection = {
          version: 1,
          request: req,
          block: '',
          createdAt: '2026-10-16',
          package: {
            baseKnowledge: job.input.baseKnowledge,
            facts: [
              {
                id: 'facts/manual',
                text: req.decisions[0].text,
                chapterId: 'chapter',
                commitId: 'commit',
                segmentId: 'seg',
                sourceVersion: 1,
                storyTime: 10,
                evidence: req.manual[0].evidence,
                knownBy: req.decisions[0].knownBy,
              },
            ],
          },
        };
        return HttpResponse.json(state.selection);
      }),
      http.post('*/go-api/planning/chapter-publications', async ({ request }) => {
        publications.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ message: '版本变更' }, { status: 409 });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <PendingWritingProvider>
            <ChapterPublication job={review} blocked={false} />
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
    await waitFor(() => expect(screen.getByRole('button', { name: t.manual })).toBeEnabled());
    if (scenario === 'publish') {
      expect(await screen.findByText('候选引文与本次章稿不一致，未载入候选。')).toBeVisible();
      expect(screen.getByRole('button', { name: p.publish })).toBeDisabled();
    }
    await user.click(screen.getByRole('button', { name: t.manual }));
    if (scenario === 'publish') {
      await screen.findByRole('dialog', { name: '重新整理本章事实' });
      await user.click(screen.getByRole('button', { name: '确认并继续' }));
    }
    await user.click(await screen.findByRole('button', { name: t.add }));
    await user.selectOptions(screen.getByRole('combobox', { name: t.source }), 's1');
    await user.type(screen.getByRole('textbox', { name: t.text }), '沈砚收到铜扣');
    await user.selectOptions(screen.getByRole('combobox', { name: /候选 1/ }), 'confirm');
    await user.click(screen.getByRole('checkbox', { name: 'shen' }));
    await user.type(
      screen.getByRole('textbox', { name: t.reason }),
      '原文明确交接，沈砚知道已收到',
    );
    expect(screen.getByRole('button', { name: p.publish })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: t.save }));
    await screen.findByRole('button', { name: t.retrySave });
    readFails = true;
    await client.invalidateQueries({ queryKey: ['chapter-facts', 'review'] });
    expect(screen.getByRole('button', { name: t.retrySave })).toBeInTheDocument();
    readFails = false;
    await user.click(screen.getByRole('button', { name: t.retrySave }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual(writes[0]);
    await waitFor(() => expect(screen.getByRole('radio', { name: p.none })).toBeEnabled());
    if (scenario === 'remote publication') {
      await user.type(screen.getByRole('textbox', { name: t.reason }), '，另补一处判断');
      receipt = {
        id: 'published-elsewhere',
        version: 1,
        assembly: { version: 1 },
        createdAt: '2026-10-16',
        request: { requestId: 'remote' },
        factSelection: state.selection,
      };
      state.published = true;
      await client.invalidateQueries({ queryKey: ['chapter-publication', 'review'] });
      await client.invalidateQueries({ queryKey: ['chapter-facts', 'review'] });
      await screen.findByText(p.saved);
      expect(screen.getByRole('textbox', { name: t.reason })).toHaveValue(
        '原文明确交接，沈砚知道已收到，另补一处判断',
      );
      expect(screen.getByRole('button', { name: t.save })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: t.cancel }));
      expect(screen.getByRole('textbox', { name: t.reason })).toHaveValue(
        '原文明确交接，沈砚知道已收到',
      );
      expect(publications).toHaveLength(0);
      view.unmount();
      client.clear();
      return;
    }
    await user.click(screen.getByRole('radio', { name: p.none }));
    await user.click(screen.getByRole('button', { name: p.publish }));
    await waitFor(() => expect(publications).toHaveLength(1));
    expect(publications[0]).toMatchObject({ factJobId: 'facts', factVersion: 1 });
    expect(writes[0].decisions[0].knownBy).toEqual(['shen']);
    view.unmount();
    client.clear();
  },
);
