import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
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
  expect(screen.queryByRole('checkbox', { name: t.confirm })).not.toBeInTheDocument();
  await user.click(screen.getByText('复审批次与重新检查', { selector: 'summary' }));
  await user.click(screen.getByText('检查设置', { selector: 'summary' }));
  expect(screen.getByRole('checkbox', { name: /加强衔接检查/ })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /加强衔接检查/ })).not.toBeChecked();
  job.status = 'failed';
  job.message = '本轮审稿失败';
  await user.click(screen.getByRole('button', { name: t.refresh }));
  await screen.findByText('本轮审稿失败');
  expect(screen.queryByRole('region', { name: '检查进度' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: t.reason })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.approve })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重试整章复审' })).toBeEnabled();
  job.status = 'completed';
  job.approvalBlock = '';
  job.output = {
    critics: [
      { critic: 'hard_consistency', status: 'completed', findings: [] },
      { critic: 'ai_taste', status: 'completed', findings: [] },
    ],
  };
  await user.click(screen.getByRole('button', { name: t.refresh }));
  await user.click(await screen.findByRole('tab', { name: '作者决定' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: t.confirm })).not.toBeChecked());
  await user.type(screen.getByRole('textbox', { name: t.reason }), '已通读并核对两段之间的动作');
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

it('requires explicit judgement for a P3 and sends its identity with chapter approval', async () => {
  const job = {
    id: 'judgement',
    status: 'completed',
    provider: 'fake',
    model: 'fake',
    current: true,
    approvalBlock: '仍有待裁决的问题',
    canApproveAfterJudgement: true,
    inputDigest: 'd',
    input: { assemblyId: 'a', draftVersion: 1, assemblyDigest: 'd', parts: [] },
    calls: [],
    message: '审核完成',
    createdAt: '2026-10-18',
    output: {
      critics: [
        { critic: 'hard_consistency', status: 'completed', findings: [] },
        {
          critic: 'ai_taste',
          status: 'completed',
          findings: [
            {
              id: 'p3',
              critic: 'ai_taste',
              severity: 'P3',
              requiresHuman: true,
              quote: '原文',
              reason: '风格建议',
              suggestion: '可删',
              repairScope: 'phrase',
              evidence: [],
            },
          ],
        },
      ],
    },
  } as unknown as ChapterReviewJob;
  const requests: ChapterReviewDecision[] = [];
  server.use(
    http.get('*/go-api/planning/chapter-reviews', () =>
      HttpResponse.json({ current: true, jobs: [job] }),
    ),
    http.post('*/go-api/planning/chapter-reviews/judgement/decisions', async ({ request }) => {
      requests.push((await request.json()) as ChapterReviewDecision);
      return HttpResponse.json({ message: '保留重试' }, { status: 503 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterReview
        assemblies={[{ id: 'a', version: 1, digest: 'd' } as ChapterAssembly]}
        editing={false}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const group = await screen.findByText('语言与重复 · 1 个问题（已完成）');
  expect(group.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('风格建议')).not.toBeVisible();
  expect(screen.queryByRole('textbox', { name: t.reason })).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '作者决定' }));
  await user.type(
    screen.getByRole('textbox', { name: t.reason }),
    '该处动作表现人物习惯，决定保留',
  );
  await user.click(screen.getByRole('checkbox', { name: t.confirm }));
  expect(screen.getByRole('button', { name: t.approve })).toBeDisabled();
  await user.click(screen.getByRole('tab', { name: '审查意见 · 1' }));
  await user.click(group);
  await user.click(screen.getByText('当前章稿'));
  await user.click(screen.getByRole('checkbox', { name: '保留这处原文（作者已判断）' }));
  await user.click(screen.getByRole('tab', { name: '作者决定' }));
  expect(screen.getByRole('textbox', { name: t.reason })).toHaveValue(
    '该处动作表现人物习惯，决定保留',
  );
  await user.click(screen.getByRole('button', { name: t.approve }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].keptFindings).toEqual(['ai_taste/p3']);
  view.unmount();
  client.clear();
});

it('shows a failed review as unverified evidence, with a nearby retry instead of zero problems or author approval', async () => {
  const assembly = {
    id: 'failed-assembly',
    version: 2,
    digest: 'digest-v2',
    createdAt: '2026-10-18',
  } as ChapterAssembly;
  const failure = {
    stage: '结果校验',
    code: 'evidence_quote_mismatch',
    finding: 2,
    message: '第 2 条意见的证据 1 无法在对应原文中逐字找到，不能作为审查依据。',
  };
  const job: ChapterReviewJob = {
    id: 'failed-review',
    status: 'failed',
    provider: 'deepseek',
    model: 'test',
    inputDigest: 'input',
    input: { assemblyId: assembly.id, draftVersion: 2, assemblyDigest: assembly.digest, parts: [] },
    message: 'invalid_content',
    failure,
    current: true,
    approvalBlock: '两路整章复审尚未完整完成',
    createdAt: '2026-10-18',
    calls: [],
    output: {
      critics: [
        { critic: 'hard_consistency', status: 'completed', findings: [] },
        { critic: 'ai_taste', status: 'failed', error: 'invalid_content', failure, findings: [] },
      ],
    },
  };
  const requests: ChapterReviewRequest[] = [];
  server.use(
    http.get('*/go-api/planning/chapter-reviews', () =>
      HttpResponse.json({ current: true, reason: '', jobs: [job] }),
    ),
    http.post('*/go-api/planning/chapter-reviews', async ({ request }) => {
      requests.push((await request.json()) as ChapterReviewRequest);
      job.status = 'running';
      return HttpResponse.json(job);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterReview
        assemblies={[assembly]}
        editing={false}
        onRead={() => {}}
        enhancedContinuity={false}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('region', { name: '复审失败原因' });
  expect(screen.getByText('审查未完成 · 已返回的结果')).toBeVisible();
  expect(screen.getByText('语言与重复 · 未完成')).toBeVisible();
  expect(screen.queryByText('审查意见与依据 · 0 个问题')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.approve })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重试整章复审' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    assemblyId: assembly.id,
    assemblyVersion: 2,
    assemblyDigest: assembly.digest,
  });
  view.unmount();
  client.clear();
});

it('opens frozen review text without changing the manuscript and keeps decisions one keyboard step away', async () => {
  const onRead = vi.fn();
  const job = {
    id: 'snapshot-review',
    status: 'completed',
    provider: 'real',
    model: 'test',
    current: true,
    approvalBlock: '',
    inputDigest: 'snapshot-digest',
    createdAt: '2026-10-18',
    calls: [],
    message: '完成',
    input: {
      assemblyId: 'a',
      draftVersion: 2,
      assemblyDigest: 'd',
      parts: [
        {
          beatId: 'beat',
          title: '渡口问话',
          segments: [{ id: 'segment', text: '审核时冻结的原文', kind: 'segment' }],
          facts: [],
        },
      ],
    },
    output: { critics: [{ critic: 'ai_taste', status: 'completed', findings: [] }] },
  } as unknown as ChapterReviewJob;
  server.use(
    http.get('*/go-api/planning/chapter-reviews', () =>
      HttpResponse.json({ current: true, jobs: [job] }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChapterReview
        assemblies={[{ id: 'a', version: 2, digest: 'd' } as ChapterAssembly]}
        editing={false}
        onRead={onRead}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '对照审核原文（只读）' }));
  expect(onRead).toHaveBeenCalledWith(
    expect.objectContaining({
      title: '复审章稿 v2',
      parts: [
        {
          id: 'beat',
          title: '渡口问话',
          segments: [{ id: 'segment', text: '审核时冻结的原文', version: 2 }],
        },
      ],
    }),
  );
  await user.click(screen.getByRole('tab', { name: '审查意见 · 0' }));
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: '作者决定' })).toHaveFocus();
  expect(screen.getByRole('textbox', { name: t.reason })).toBeVisible();
  expect(screen.getByText('参考与技术记录').closest('details')).not.toHaveAttribute('open');
  view.unmount();
  client.clear();
});
