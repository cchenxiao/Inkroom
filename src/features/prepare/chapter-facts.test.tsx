import { beforeAll, afterEach, afterAll, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
      http.get('*/go-api/planning', () => HttpResponse.json({ jobs: [] })),
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
      await user.click(screen.getByRole('button', { name: '2 确认定稿' }));
      expect(screen.getByRole('button', { name: p.publish })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: '1 核对事实' }));
    }
    await user.click(screen.getByRole('button', { name: t.manual }));
    expect(screen.queryByRole('dialog', { name: '重新整理本章事实' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: t.add }));
    await user.selectOptions(screen.getByRole('combobox', { name: t.source }), 's1');
    await user.type(screen.getByRole('textbox', { name: t.text }), '沈砚收到铜扣');
    await user.selectOptions(screen.getByRole('combobox', { name: /候选 1/ }), 'confirm');
    await user.click(screen.getByRole('checkbox', { name: 'shen' }));
    await user.clear(screen.getByRole('textbox', { name: t.reason }));
    await user.type(
      screen.getByRole('textbox', { name: t.reason }),
      '原文明确交接，沈砚知道已收到',
    );
    await user.click(screen.getByRole('button', { name: '2 确认定稿' }));
    expect(screen.getByRole('button', { name: p.publish })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '返回核对事实' }));
    expect(screen.getByRole('textbox', { name: t.reason })).toHaveValue(
      '原文明确交接，沈砚知道已收到',
    );
    await user.click(screen.getByRole('button', { name: t.save }));
    await screen.findByRole('button', { name: t.retrySave });
    readFails = true;
    await client.invalidateQueries({ queryKey: ['chapter-facts', 'review'] });
    expect(screen.getByRole('button', { name: t.retrySave })).toBeInTheDocument();
    readFails = false;
    await user.click(screen.getByRole('button', { name: t.retrySave }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual(writes[0]);
    await user.click(screen.getByRole('button', { name: '2 确认定稿' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: p.none })).toBeEnabled());
    if (scenario === 'remote publication') {
      await user.click(screen.getByRole('button', { name: '1 核对事实' }));
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
      await user.click(screen.getByText('已保存的事实决定', { selector: 'summary' }));
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

it('offers direct and batch decisions without opening evidence, preserving previous decisions and knowledge boundaries', async () => {
  const review = {
    id: 'review',
    current: true,
    input: { parts: [] },
  } as unknown as ChapterReviewJob;
  const candidate = {
    id: 'one',
    text: '钥匙已归还',
    kind: 'event',
    relatedFactId: '',
    evidence: { ref: 's', quote: '他把钥匙交还。' },
    reason: '原文明确交接',
  };
  const job = {
    id: 'facts',
    status: 'completed',
    provider: 'real',
    calls: [],
    message: '整理完成',
    request: { mode: 'model' },
    input: {
      review: { parts: [] },
      knowledge: { characters: ['shen'], facts: [{ id: 'old', text: '旧设定' }] },
    },
    output: {
      candidates: [
        candidate,
        {
          ...candidate,
          id: 'two',
          text: '离开渡口',
          suggestedKnowers: [{ characterId: 'shen', evidence: candidate.evidence }],
        },
        { ...candidate, id: 'speech', kind: 'statement', text: '台词中的说法' },
        { ...candidate, id: 'conflict', relatedFactId: 'old', text: '涉及旧设定的候选' },
      ],
    },
  } as unknown as FactsJob;
  const writes: FactsSelectionRequest[] = [];
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json({ jobs: [] })),
    http.post('*/go-api/planning/chapter-fact-selections', async ({ request }) => {
      writes.push((await request.json()) as FactsSelectionRequest);
      return HttpResponse.json({ message: '保存结果未确认' }, { status: 503 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { default: ChapterFacts } = await import('./components/ChapterFacts');
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterFacts
        review={review}
        state={{ job, selection: null, current: true, published: false, block: '' }}
        blocked={false}
        onChange={() => {}}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const first = within(screen.getByRole('article', { name: '事实 1' }));
  const detail = first.getByText('证据与调整', { selector: 'summary' });
  expect(detail.closest('details')).not.toHaveAttribute('open');
  await user.click(first.getByRole('button', { name: '不记入事实' }));
  await user.click(screen.getByText('分别调整批量决定（暂不保存）'));
  await user.click(screen.getByRole('button', { name: '将 1 条普通事件计入' }));
  expect(first.getByText('· 已选不计入', { exact: false })).toBeVisible();
  expect(first.queryByRole('button', { name: '计入事实' })).not.toBeInTheDocument();
  const second = within(screen.getByRole('article', { name: '事实 2' }));
  expect(second.getByText('· 已选计入', { exact: false })).toBeVisible();
  expect(second.getByRole('checkbox', { name: 'shen' })).toBeChecked();
  await user.click(second.getByRole('checkbox', { name: 'shen' }));
  await user.click(second.getByRole('button', { name: '更改决定' }));
  await user.click(second.getByRole('button', { name: '计入事实' }));
  expect(second.getByRole('checkbox', { name: 'shen' })).not.toBeChecked();
  expect(screen.getByText('已处理 2/4 条 · 未保存')).toBeVisible();
  expect(
    within(screen.getByRole('article', { name: '事实 3' })).queryByRole('button', {
      name: '计入事实',
    }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('article', { name: '事实 4' })).queryByRole('button', {
      name: '计入事实',
    }),
  ).not.toBeInTheDocument();
  await user.click(detail);
  expect(first.getByRole('textbox', { name: t.reason })).toHaveValue('作者选择不写入章末事实');
  await user.clear(first.getByRole('textbox', { name: t.reason }));
  await user.type(first.getByRole('textbox', { name: t.reason }), '已在上一章记录');
  await user.click(detail);
  await user.click(first.getByRole('button', { name: '更改决定' }));
  await user.click(first.getByRole('button', { name: '计入事实' }));
  await user.click(detail);
  expect(first.getByRole('textbox', { name: t.reason })).toHaveValue('已在上一章记录');
  const speech = within(screen.getByRole('article', { name: '事实 3' }));
  await user.click(speech.getByRole('button', { name: '调整分类并计入' }));
  expect(screen.getByRole('button', { name: t.save })).toBeDisabled();
  await user.clear(speech.getByRole('textbox', { name: '修正后的事实' }));
  await user.type(speech.getByRole('textbox', { name: '修正后的事实' }), '陆青说过钥匙已归还');
  await user.click(speech.getByRole('button', { name: '应用修正并计入' }));
  expect(speech.getByText('作者修正：记录说话 / 回忆这一行为，不判定话中内容为真')).toBeVisible();
  expect(speech.queryByRole('button', { name: '计入事实' })).not.toBeInTheDocument();
  expect(speech.getByRole('checkbox', { name: 'shen' })).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: '排除其余 1 条' }));
  expect(screen.getByText('已处理 4/4 条 · 未保存')).toBeVisible();
  await user.click(first.getByRole('button', { name: '更改决定' }));
  await user.click(first.getByRole('button', { name: '撤销决定' }));
  expect(screen.getByText('已处理 3/4 条 · 未保存')).toBeVisible();
  expect(writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: t.save }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].decisions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        candidateId: 'two',
        action: 'confirm',
        knownBy: [],
        reason: '作者选择确认为新增事实',
      }),
      expect.objectContaining({
        candidateId: 'speech',
        action: 'confirm',
        eventBasis: 'speech_act',
        text: '陆青说过钥匙已归还',
        knownBy: [],
      }),
      expect.objectContaining({ candidateId: 'conflict', action: 'exclude' }),
    ]),
  );
  expect(writes[0].decisions.some((d) => d.candidateId === 'one')).toBe(false);
  view.unmount();
  client.clear();
});

it.each(['events', 'exclude'] as const)(
  'finishes remaining fact decisions from the publication step: %s',
  async (mode) => {
    const review = {
      id: 'quick-review',
      current: true,
      status: 'completed',
      inputDigest: 'digest',
      input: { draftVersion: 1, parts: [] },
      decision: { action: 'approve', requestId: 'approval' },
    } as unknown as ChapterReviewJob;
    const candidates = ['event', 'event', 'statement', 'uncertain'].map((kind, i) => ({
      id: String(i),
      kind,
      text: `事实${i}`,
      relatedFactId: '',
      reason: '',
      evidence: { ref: 's', quote: '证据' },
    }));
    const job = {
      id: 'quick-facts',
      status: 'completed',
      provider: 'real',
      request: { mode: 'model' },
      calls: [],
      input: { review: review.input, knowledge: { characters: [], facts: [] } },
      output: { candidates },
    } as unknown as FactsJob;
    const original = {
      candidateId: '0',
      action: 'confirm' as const,
      text: '作者已修改的事实',
      knownBy: [],
      reason: '已核对',
    };
    const state: FactsState = {
      job,
      selection: {
        version: 2,
        request: {
          requestId: 'old',
          jobId: job.id,
          expectedVersion: 1,
          manual: [],
          decisions: [original],
        },
        package: { baseKnowledge: { version: 1, digest: 'k' }, facts: [] },
        block: '仍有事实候选未逐条决定',
        createdAt: '',
      },
      current: true,
      published: false,
      block: '仍有事实候选未逐条决定',
    };
    const writes: FactsSelectionRequest[] = [];
    server.use(
      http.get('*/go-api/planning', () => HttpResponse.json({ jobs: [] })),
      http.get('*/go-api/planning/chapter-reviews/quick-review/publication', () =>
        HttpResponse.json({ publication: null, current: true }),
      ),
      http.get('*/go-api/planning/chapter-reviews/quick-review/facts', () =>
        HttpResponse.json(state),
      ),
      http.post('*/go-api/planning/chapter-fact-selections', async ({ request }) => {
        const req = (await request.json()) as FactsSelectionRequest;
        writes.push(req);
        if (mode === 'events' && writes.length === 1)
          return HttpResponse.json({ message: '结果未确认' }, { status: 503 });
        state.selection = { ...state.selection!, version: 3, request: req, block: '' };
        state.block = '';
        return HttpResponse.json(state.selection);
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
    await screen.findByText('已处理 1/4 条');
    await user.click(screen.getByRole('button', { name: '2 确认定稿' }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: p.none })).toBeDisabled();
    await user.click(
      screen.getByRole('button', {
        name:
          mode === 'events' ? '计入 1 条事件，其余 2 条不计入并保存' : '剩余 3 条全部不计入并保存',
      }),
    );
    await waitFor(() => expect(writes).toHaveLength(1));
    if (mode === 'events') {
      await user.click(await screen.findByRole('button', { name: t.retrySave }));
      await waitFor(() => expect(writes).toHaveLength(2));
      expect(writes[1]).toEqual(writes[0]);
    }
    expect(writes[0].expectedVersion).toBe(2);
    expect(writes[0].decisions[0]).toEqual(original);
    expect(writes[0].decisions.map((d) => d.action)).toEqual([
      'confirm',
      mode === 'events' ? 'confirm' : 'exclude',
      'exclude',
      'exclude',
    ]);
    await waitFor(() => expect(screen.getByRole('radio', { name: p.none })).toBeEnabled());
    await user.click(screen.getByRole('radio', { name: p.none }));
    expect(screen.getByRole('button', { name: p.publish })).toBeEnabled();
    view.unmount();
    client.clear();
  },
);
