import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { usePlannedWriting } from './hooks/usePlannedWriting';
function Probe() {
  const w = usePlannedWriting('first', '', false);
  return (
    <>
      <button
        disabled={!!w.block || !w.gate.data?.ready || !!w.pendingStart}
        onClick={() => w.begin()}
      >
        生成选定 Beat 正文
      </button>
      <button onClick={w.refresh}>刷新写作状态</button>
      {w.pendingStart && <button onClick={w.retryStart}>重试本次开工请求</button>}
    </>
  );
}
import type { PlannedRunRequest } from './api/planned-run';
const { planning } = vi.hoisted(() => ({
  planning: {
    data: {
      input: { version: 1 },
      directionVersion: 1,
      styleVersion: 1,
      coreVersion: 1,
      outlineVersion: 2,
      outlineSelection: { bindingsVersion: 2 },
      chapterPlans: [{ chapterId: 'first', version: 2, confirmed: true }],
    },
    isError: false,
  },
}));
vi.mock('./hooks/usePlanning', () => ({ usePlanning: () => planning }));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('sends planning and draft versions, preserves retry identity, and blocks an obsolete plan', async () => {
  const expected = {
    planning: { input: 1, direction: 1, style: 1, core: 1 },
    outline: 2,
    bindings: 2,
  };
  let planVersion = 2;
  const requests: PlannedRunRequest[] = [];
  server.use(
    http.get('*/go-api/planning/chapter-runs', () =>
      HttpResponse.json({
        ready: true,
        reason: '',
        draftVersion: 0,
        planVersion,
        expected,
        runs: [],
      }),
    ),
    http.post('*/go-api/planning/chapter-runs', async ({ request }) => {
      requests.push((await request.json()) as PlannedRunRequest);
      return HttpResponse.json({ code: 'unavailable', message: '暂时不可用' }, { status: 503 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup(),
    start = await screen.findByRole('button', { name: '生成选定 Beat 正文' }, { timeout: 5000 });
  await waitFor(() => expect(start).toBeEnabled());
  await user.click(start);
  await user.click(await screen.findByRole('button', { name: '重试本次开工请求' }));
  expect(screen.getByRole('button', { name: '生成选定 Beat 正文' })).toBeDisabled();
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0]).toMatchObject({
    chapterId: 'first',
    expected,
    planVersion: 2,
    draftVersion: 0,
    autoRevise: false,
  });
  expect(requests[1].requestId).toBe(requests[0].requestId);
  planVersion = 1;
  await user.click(screen.getByRole('button', { name: '刷新写作状态' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '生成选定 Beat 正文' })).toBeDisabled(),
  );
  view.unmount();
  client.clear();
});

function ScopeProbe() {
  const w = usePlannedWriting('first', 'middle', false);
  return (
    <>
      <button
        disabled={!w.chapterGate.data?.ready || !!w.pendingStart}
        onClick={() => w.beginChapter()}
      >
        生成整章候选
      </button>
      <button
        disabled={!w.chapterGate.data?.ready || !!w.pendingStart}
        onClick={() => w.beginChapter(true)}
      >
        继续生成剩余段落
      </button>
      <button
        disabled={!w.run || !w.current || !!w.pendingStart}
        onClick={() =>
          void w.revise({
            segmentId: 's2',
            original: '中间正文',
            start: 0,
            end: 2,
            instruction: '重写开头',
            preview: true,
          })
        }
      >
        修改已采用选区
      </button>
      {w.pendingStart && <button onClick={w.retryStart}>重试范围请求</button>}
    </>
  );
}
vi.mock('./hooks/useBackendEvents', () => ({ useBackendEvents: () => undefined }));
it.each(['chapter', 'remaining', 'rewrite'] as const)(
  'preserves %s scope and source versions across a failed start',
  async (scope) => {
    const expected = {
      planning: { input: 1, direction: 1, style: 1, core: 1 },
      outline: 2,
      bindings: 2,
    };
    const source = {
      id: 'adopted',
      chapterId: 'draft-chapter',
      status: 'committed',
      draftVersion: 7,
      eventSequence: 1,
    };
    const requests: PlannedRunRequest[] = [];
    server.use(
      http.get('*/go-api/planning/chapter-runs', ({ request }) =>
        HttpResponse.json({
          ready: true,
          reason: '',
          beatId:
            new URL(request.url).searchParams.get('mode') === 'chapter' ? '__chapter__' : 'middle',
          draftVersion: new URL(request.url).searchParams.get('mode') === 'chapter' ? 0 : 3,
          planVersion: 2,
          expected,
          runs: [source],
        }),
      ),
      http.get('*/go-api/runs/adopted', () => HttpResponse.json(source)),
      http.get('*/go-api/chapters/draft-chapter', () =>
        HttpResponse.json({ draftVersion: 7, segments: [] }),
      ),
      http.post('*/go-api/planning/chapter-runs', async ({ request }) => {
        requests.push((await request.json()) as PlannedRunRequest);
        return HttpResponse.json({ message: '连接中断' }, { status: 503 });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ScopeProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const button = screen.getByRole('button', {
      name:
        scope === 'chapter'
          ? '生成整章候选'
          : scope === 'remaining'
            ? '继续生成剩余段落'
            : '修改已采用选区',
    });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(requests).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: '重试范围请求' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual(requests[0]);
    if (scope !== 'rewrite')
      expect(requests[0]).toMatchObject({
        mode: 'chapter',
        remaining: scope === 'remaining',
        draftVersion: 0,
        expected,
      });
    else
      expect(requests[0]).toMatchObject({
        mode: 'beat',
        beatId: 'middle',
        draftVersion: 3,
        fromRunId: 'adopted',
        sourceVersion: 7,
        autoRevise: false,
        rewrite: { segmentId: 's2', original: '中间正文', start: 0, end: 2, preview: true },
      });
    view.unmount();
    client.clear();
  },
);
