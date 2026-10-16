import { isLiveWorkspace } from '@/shared/lib/writing-mode';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { useWritingPending } from '@/shared/lib/pending-writing';
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { Layout } from '@/app/layout';
import { useUIStore } from '@/shared/lib/ui-store';

function EditingProbe() {
  const [text, setText] = useState('');
  useWritingPending(Boolean(text));
  return (
    <>
      <p>真实稿本入口</p>
      <textarea aria-label="修改正文" value={text} onChange={(e) => setText(e.target.value)} />
    </>
  );
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
it('does not mount the demo shell around real workspace routes', async () => {
  expect(isLiveWorkspace('/Workspace/', '?source=planned', 'project-zhuoliu', 'main')).toBe(true);
  useUIStore.setState({
    projectId: 'project-zhuoliu',
    branchId: 'main',
    chapterId: 'ch7',
    stale: true,
    attention: 'review',
    focus: false,
  });
  let mockRequests = 0;
  server.use(
    http.all('*/api/*', () => {
      mockRequests++;
      return HttpResponse.json({});
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createMemoryRouter(
          [{ element: <Layout />, children: [{ path: 'workspace', element: <EditingProbe /> }] }],
          { initialEntries: ['/Workspace/?projectId=project-zhuoliu&branchId=main'] },
        )}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('真实稿本入口')).toBeVisible();
  expect(screen.queryByText(/旧审批与建议已失效/)).not.toBeInTheDocument();
  expect(screen.queryByText('夜谈')).not.toBeInTheDocument();
  expect(mockRequests).toBe(0);
  view.unmount();
  client.clear();
});

it('uses Go chapter IDs from the outline and keeps empty/error states separate from demo data', async () => {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  const { default: WorkspaceEntry } = await import('@/app/components/workspace-entry');
  const input = await import('../../internal/demo/core_settings.json');
  useUIStore.setState({
    projectId: 'project-zhuoliu',
    branchId: 'main',
    chapterId: 'ch7',
    focus: false,
    attention: null,
    leftOpen: false,
  });
  const versions = {
    planning: { input: 1, direction: 1, style: 1, core: 1 },
    outline: 1,
    bindings: 1,
  };
  let showOutline = false,
    failed = false;
  let confirmed = true;
  let posted: Record<string, unknown> | undefined;
  const requests: Record<string, unknown>[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scene = {
    id: 'scene-real',
    title: '钟楼',
    goal: '找到故障',
    conflict: '对方隐瞒',
    outcome: '获得线索',
    povCharacterId: 'c1',
    characterIds: ['c1'],
    storyTime: null,
    beats: [{ id: 'beat-real', title: '听钟', action: '聆听', turn: '发现缺口' }],
  };
  server.use(
    http.get('*/go-api/planning', () =>
      failed
        ? HttpResponse.json({ message: '服务暂不可用' }, { status: 503 })
        : HttpResponse.json({
            input: input.source,
            selection: input.selection,
            directionVersion: 1,
            styleVersion: 1,
            styleSelection: input.style,
            coreVersion: 1,
            coreSelection: {
              version: 1,
              inputVersion: 1,
              directionVersion: 1,
              styleVersion: 1,
              content: {
                characters: [{ id: 'c1', name: '林舟', voice: [], hardFactIds: [] }],
                worldFacts: [],
                plans: [],
              },
              decisions: { c1: 'confirmed' },
            },
            outlineVersion: 1,
            outlineSelection: showOutline
              ? {
                  version: 1,
                  bindingsVersion: 1,
                  versions: versions.planning,
                  confirmed: true,
                  content: {
                    chapters: [
                      { id: 'first-real', title: '钟楼来客' },
                      { id: 'second-real', title: '河边' },
                    ],
                  },
                }
              : null,
            chapterPlans: [
              {
                chapterId: 'first-real',
                version: 1,
                versions,
                confirmed,
                content: { scenes: [scene], brief: { selectedBeatId: 'beat-real' } },
              },
            ],
            jobs: [],
            styleJobs: [],
            coreJobs: [],
            outlineJobs: [],
            chapterPlanJobs: [],
            packs: [],
          }),
    ),
    http.get('*/go-api/planning/chapter-runs', ({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get('chapterId')).toBe('first-real');
      if (query.get('mode') !== 'chapter') expect(query.get('beatId')).toBe('beat-real');
      return HttpResponse.json({
        ready: !posted,
        reason: posted ? '规划版本已变化' : '',
        beatId: 'beat-real',
        draftVersion: 0,
        planVersion: 1,
        expected: versions,
        runs: [],
      });
    }),
    http.post('*/go-api/planning/chapter-runs', async ({ request }) => {
      posted = (await request.json()) as Record<string, unknown>;
      requests.push(posted);
      if (requests.length === 1) return HttpResponse.json({ message: '未知结果' }, { status: 503 });
      return HttpResponse.json(
        { code: 'version_mismatch', message: '规划版本已变化' },
        { status: 409 },
      );
    }),
    http.post('*/go-api/planning/chapter-assemblies/preview', () =>
      HttpResponse.json({
        ready: false,
        reason: '尚缺已提交正文',
        slots: [],
        draft: { parts: [] },
        history: [],
      }),
    ),
  );
  const router = createMemoryRouter(
    [{ element: <Layout />, children: [{ path: 'workspace', element: <WorkspaceEntry /> }] }],
    { initialEntries: ['/workspace?projectId=project-zhuoliu&branchId=main&chapterId=ch7'] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText('尚未准备章节', {}, { timeout: 5000 });
  expect(screen.queryByText('夜谈')).not.toBeInTheDocument();
  failed = true;
  await user.click(screen.getByRole('button', { name: '刷新规划' }));
  await screen.findByRole('button', { name: '刷新规划' });
  expect(screen.queryByText('夜谈')).not.toBeInTheDocument();
  failed = false;
  showOutline = true;
  await user.click(screen.getByRole('button', { name: '刷新规划' }));
  await screen.findByRole('region', { name: '正文创作台' });
  await user.click(screen.getAllByRole('button', { name: '生成本段' })[0]);
  await user.click(screen.getByRole('button', { name: '审核本段' }));
  expect(posted).toMatchObject({
    chapterId: 'first-real',
    beatId: 'beat-real',
    draftVersion: 0,
    expected: versions,
  });
  expect(posted?.requestId).toBeTruthy();
  confirmed = false;
  await user.click(screen.getByRole('button', { name: '刷新规划' }));
  await screen.findAllByText(/先确认当前章/);
  await user.click(await screen.findByRole('button', { name: '重试原请求' }));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await screen.findAllByText('规划版本已变化');
  for (const button of screen.getAllByRole('button', { name: '生成本段' }))
    expect(button).toBeDisabled();

  expect(screen.queryByRole('link', { name: '人工审核' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '整章审核' }));
  expect(screen.getByRole('link', { name: '章节写作' })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByText('先完成段落审核')).toBeVisible();
  expect(screen.queryByRole('button', { name: '保存章稿' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '展开结构' }));
  expect(screen.queryByRole('dialog', { name: '章节目录' })).not.toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: '章节目录' })).toBeVisible();
  expect(screen.getByRole('complementary', { name: '正文旁审核' })).toBeVisible();
  expect(screen.getByRole('region', { name: '正文创作台' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '收起结构' }));
  expect(screen.queryByRole('complementary', { name: '章节目录' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '展开结构' })).toBeVisible();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
  view.unmount();
  client.clear();
});
