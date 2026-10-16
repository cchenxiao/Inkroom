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
it('keeps mock chapter state and actions out of the real writing shell', async () => {
  expect(isLiveWorkspace('/Workspace/', '?source=planned', 'project-zhuoliu', 'main')).toBe(true);
  useUIStore.setState({
    projectId: 'project-zhuoliu',
    branchId: 'main',
    chapterId: 'ch7',
    stale: true,
    attention: 'review',
    focus: true,
  });
  let mockRequests = 0;
  server.use(
    http.all('*/api/*', () => {
      mockRequests++;
      return HttpResponse.json({});
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              element: <Layout />,
              children: [{ path: 'workspace', element: <EditingProbe /> }],
            },
          ],
          { initialEntries: ['/Workspace/?projectId=project-zhuoliu&branchId=main'] },
        )}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('真实创作')).toBeInTheDocument();
  expect(screen.getByText('真实稿本入口')).toBeVisible();
  expect(screen.queryByText(/旧审批与建议已失效/)).not.toBeInTheDocument();
  expect(screen.queryByText('Agent 工作台')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '人工审核' })).toHaveAttribute(
    'href',
    expect.stringContaining('stage=assembly'),
  );
  expect(mockRequests).toBe(0);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('修改正文'), '保留我的修改');
  await user.click(screen.getByRole('link', { name: '人工审核' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('修改正文')).toHaveValue('保留我的修改');
  await user.click(screen.getByRole('link', { name: '查看演示工作台' }));
  await screen.findByRole('dialog', { name: '离开当前编辑？' });
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('修改正文')).toHaveValue('保留我的修改');
  expect(mockRequests).toBe(0);
  client.clear();
});

it('uses Go chapter IDs from the outline and keeps empty/error states separate from demo data', async () => {
  const { default: WorkspaceEntry } = await import('@/app/components/workspace-entry');
  const input = await import('../../internal/demo/core_settings.json');
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main', chapterId: 'ch7' });
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
              content: { characters: [{ id: 'c1', name: '林舟' }] },
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
      expect(query.get('beatId')).toBe('beat-real');
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
  await screen.findByText('先为故事准备一个开头');
  expect(screen.queryByText('夜谈')).not.toBeInTheDocument();
  failed = true;
  await user.click(screen.getByRole('button', { name: '刷新规划' }));
  await screen.findByText('暂时无法读取真实规划，请确认 Go 服务已启动。');
  expect(screen.queryByText('夜谈')).not.toBeInTheDocument();
  failed = false;
  showOutline = true;
  await user.click(screen.getByRole('button', { name: '刷新规划' }));
  await user.click(await screen.findByRole('button', { name: '生成选定 Beat 正文' }));
  expect(posted).toMatchObject({
    chapterId: 'first-real',
    beatId: 'beat-real',
    draftVersion: 0,
    expected: versions,
  });
  expect(posted?.requestId).toBeTruthy();
  confirmed = false;
  await user.click(screen.getByRole('button', { name: '刷新规划' }));
  await screen.findByText(/本章细纲尚未确认/);
  await user.click(await screen.findByRole('button', { name: '重试本次开工请求' }));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await screen.findAllByText('规划版本已变化');
  expect(screen.getByRole('button', { name: '生成选定 Beat 正文' })).toBeDisabled();
  expect(router.state.location.search).toContain('planningChapterId=first-real');
  await user.click(screen.getByRole('link', { name: '组稿与复审' }));
  expect(await screen.findByRole('button', { name: '保存章稿' })).toBeDisabled();
  view.unmount();
  client.clear();
});
