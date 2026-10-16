import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { useChapterCandidates } from './hooks/useChapterCandidates';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('loads unaccepted candidates for every beat on a cold open and keeps chapter caches separate', async () => {
  server.use(
    http.get('*/go-api/planning/chapter-runs', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const beat = params.get('beatId');
      const chapter = params.get('chapterId');
      return HttpResponse.json({
        beatId: beat,
        runs: [
          {
            id: `${chapter}-${beat}`,
            status: 'waiting_human',
            result: {
              segments: [{ id: `text-${beat}`, version: 2, text: `${chapter}的${beat}候选正文` }],
            },
          },
        ],
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ chapter }) => useChapterCandidates(chapter, ['first', 'second']), {
    wrapper,
    initialProps: { chapter: 'chapter-one' },
  });
  await waitFor(() => expect(hook.result.current.every((query) => query.isSuccess)).toBe(true));
  expect(hook.result.current.map((query) => query.data?.runs[0].result?.segments[0].text)).toEqual([
    'chapter-one的first候选正文',
    'chapter-one的second候选正文',
  ]);
  hook.rerender({ chapter: 'chapter-two' });
  await waitFor(() => expect(hook.result.current[0].data?.runs[0].id).toBe('chapter-two-first'));
  expect(hook.result.current[1].data?.runs[0].result?.segments[0].text).toBe(
    'chapter-two的second候选正文',
  );
  hook.unmount();
  client.clear();
});
