import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import fixture from '../../../internal/demo/knowledge.json';
import BackendKnowledge from './components/BackendKnowledge';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BackendKnowledge />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it('distinguishes missing data from connection errors and retries without mock fallback', async () => {
  let status = 404;
  server.use(
    http.get('*/go-api/knowledge', () =>
      HttpResponse.json({ code: 'not_found', message: 'missing' }, { status }),
    ),
  );
  const user = setup();
  await user.click(screen.getByText('已保存的知识快照'));
  await screen.findByText('尚未发布知识快照');
  expect(screen.queryByText(fixture.facts[0].text)).not.toBeInTheDocument();
  status = 503;
  await user.click(screen.getByRole('button', { name: '刷新快照' }));
  await screen.findByRole('alert');
  expect(
    screen.getByText('无法读取 Go 后端的知识快照，请确认服务状态后重试。'),
  ).toBeInTheDocument();
  expect(screen.queryByText('尚未发布知识快照')).not.toBeInTheDocument();
});
it('reads history separately and hides old success data on failure; beliefs and author plans stay labeled', async () => {
  const requests: string[] = [];
  server.use(
    http.get('*/go-api/knowledge', ({ request }) => {
      const version = new URL(request.url).searchParams.get('version') || '0';
      requests.push(version);
      if (version === '9')
        return HttpResponse.json({ code: 'not_found', message: 'missing' }, { status: 404 });
      return HttpResponse.json({
        digest: 'a'.repeat(64),
        origin: 'teaching_seed',
        reason: '显式教学导入',
        createdAt: '2026-10-15T00:00:00Z',
        snapshot: { ...fixture, version: version === '0' ? 2 : 1 },
      });
    }),
  );
  const user = setup();
  await user.click(screen.getByText('已保存的知识快照'));
  await screen.findByText('当前快照 v2');
  await user.click(screen.getByRole('tab', { name: '事实与知情记录' }));
  await screen.findByText('沈砚以为点灯的人是周岑。');
  expect(screen.getAllByText('误解 / 未证实理解').length).toBeGreaterThan(0);
  await user.click(screen.getByRole('tab', { name: '伏笔台账' }));
  await screen.findByText(fixture.foreshadows[1].payload);
  expect(screen.getByText('作者计划，不属于角色知识。')).toBeInTheDocument();
  const input = screen.getByRole('spinbutton', { name: '历史版本号' });
  await user.type(input, '1');
  await user.click(screen.getByRole('button', { name: '查看历史' }));
  await screen.findByText('历史快照 v1');
  await user.clear(input);
  await user.type(input, '9');
  await user.click(screen.getByRole('button', { name: '查看历史' }));
  await screen.findByText('该历史版本不存在');
  expect(screen.queryByText('历史快照 v1')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '返回当前版本' }));
  await screen.findByText('当前快照 v2');
  await waitFor(() => expect(requests).toContain('9'));
});
