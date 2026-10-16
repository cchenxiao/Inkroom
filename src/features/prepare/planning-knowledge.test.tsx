import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { useUIStore } from '@/shared/lib/ui-store';
import PlanningKnowledgePublish from './components/PlanningKnowledgePublish';
import type { KnowledgePreview, KnowledgePublishRequest } from './api/planning-knowledge';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('requires explicit author publication and invalidates confirmation after a version conflict', async () => {
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
  const source = { id: 'f1', coreVersion: 1, coreDigest: 'c'.repeat(64) };
  const snapshot = {
    projectId: 'zhuoliu',
    branchId: 'main',
    version: 1,
    confirmed: true,
    characters: ['c1'],
    facts: [
      {
        id: 'f1',
        version: 1,
        text: '钟楼每晚十点关闭。',
        source: { initial: source, chapterId: '', segmentId: '', at: { chapter: 0, storyTime: 0 } },
      },
    ],
    information: [],
    timeline: [],
    foreshadows: [],
  };
  const preview: KnowledgePreview = {
    ready: true,
    reason: '',
    expected: { input: 1, direction: 1, style: 1, core: 1 },
    expectedVersion: 0,
    previewDigest: 'a'.repeat(64),
    replacesTeaching: true,
    currentVersion: 0,
    current: false,
    snapshot,
    excluded: [{ id: 'plan1', reason: '未来计划不发布为已发生事实' }],
  };
  const bodies: KnowledgePublishRequest[] = [];
  server.use(
    http.get('*/go-api/planning/knowledge-preview', () => HttpResponse.json(preview)),
    http.post('*/go-api/planning/knowledge-publications', async ({ request }) => {
      bodies.push((await request.json()) as KnowledgePublishRequest);
      preview.ready = false;
      preview.reason = '设定已变更，请重新预览';
      return HttpResponse.json(
        { code: 'version_mismatch', message: preview.reason },
        { status: 409 },
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlanningKnowledgePublish />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('button', { name: '确认发布知识快照' }, { timeout: 5000 });
  expect(screen.getByRole('button', { name: '确认发布知识快照' })).toBeDisabled();
  await user.click(screen.getByText(/发布预览 · 尚未生效/));
  await screen.findByText('作者确认的初始设定 · 核心设定 v1 · 故事时点 0');
  expect(screen.queryByText(/第 0 章/)).not.toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: '发布理由' }), '确认开篇已知事实');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: '确认发布知识快照' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({
    expected: preview.expected,
    expectedVersion: 0,
    previewDigest: 'a'.repeat(64),
    confirm: true,
    reason: '确认开篇已知事实',
  });
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  expect(screen.getByRole('textbox', { name: '发布理由' })).toHaveValue('确认开篇已知事实');
  expect(screen.getByRole('button', { name: '确认发布知识快照' })).toBeDisabled();
  view.unmount();
  client.clear();
});
