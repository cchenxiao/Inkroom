import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PendingWritingProvider, useWritingPending } from '@/shared/lib/pending-writing';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlannedWriting } from './usePlannedWriting';
import { plannedRunApi, type PlannedRunReadiness } from '../api/planned-run';
import { trialApi } from '../api/backend';
import type { BackendRun, StoredDraft } from '../types/backend';
vi.mock('./useBackendEvents', () => ({ useBackendEvents: () => {} }));
vi.mock('./usePlanning', () => ({
  usePlanning: () => ({
    data: {
      input: { version: 1 },
      directionVersion: 1,
      styleVersion: 1,
      coreVersion: 1,
      outlineVersion: 1,
      outlineSelection: { bindingsVersion: 1 },
      chapterPlans: [{ chapterId: 'chapter', confirmed: true, version: 1 }],
    },
  }),
}));
afterEach(() => vi.restoreAllMocks());
it.each([
  { enabled: false, mode: 'chapter', status: 'failed' },
  { enabled: true, mode: 'chapter', status: 'failed' },
  { enabled: false, mode: 'beat', status: 'stale' },
])(
  'rechecks $status $mode with opt-in $enabled and no writer instruction',
  async ({ enabled, mode, status }) => {
    const expected = {
      planning: { input: 1, direction: 1, style: 1, core: 1 },
      outline: 1,
      bindings: 1,
    };
    const run = {
      id: 'failed-run',
      chapterId: 'chapter-draft',
      status,
      draftVersion: 4,
      planning: { mode, planVersion: 1, expected },
    } as unknown as BackendRun;
    vi.spyOn(plannedRunApi, 'get').mockImplementation(
      async (_c, _s, _b, mode) =>
        ({
          ready: true,
          draftVersion: mode === 'chapter' ? 4 : 9,
          planVersion: 1,
          expected,
          runs: [run],
        }) as PlannedRunReadiness,
    );
    vi.spyOn(trialApi, 'get').mockResolvedValue(run);
    vi.spyOn(plannedRunApi, 'draft').mockResolvedValue({
      version: 4,
      segments: [],
    } as unknown as StoredDraft);
    const start = vi
      .spyOn(plannedRunApi, 'start')
      .mockResolvedValue({ ...run, id: 'retry', status: 'running' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => usePlannedWriting('chapter', 'middle', false), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(view.result.current.run?.id).toBe('failed-run'));
    await waitFor(() => expect(view.result.current.chapterGate.data?.draftVersion).toBe(4));
    expect(view.result.current.enhancedContinuity).toBe(false);
    act(() => view.result.current.setEnhancedContinuity(enabled));
    await act(async () => {
      await view.result.current.revise();
    });
    expect(start.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        mode,
        draftVersion: mode === 'chapter' ? 4 : 9,
        sourceVersion: 4,
        fromRunId: 'failed-run',
        recheck: true,
        autoRevise: false,
        enhancedContinuity: enabled,
      }),
    );
    expect(start.mock.calls[0][0]).not.toHaveProperty('rewrite');
    if (mode === 'chapter') expect(start.mock.calls[0][0]).not.toHaveProperty('beatId');
    else expect(start.mock.calls[0][0].beatId).toBe('middle');
    view.unmount();
    client.clear();
  },
);

it.each([1, 2])(
  'does not interpret a pending readiness response as stale (returned plan %s)',
  async (planVersion) => {
    let resolve!: (value: PlannedRunReadiness) => void;
    const response = new Promise<PlannedRunReadiness>((done) => {
      resolve = done;
    });
    vi.spyOn(plannedRunApi, 'get').mockReturnValue(response);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => usePlannedWriting('chapter', 'middle', false), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.current).toBe(false);
    expect(view.result.current.block).toBeUndefined();
    await act(async () =>
      resolve({
        ready: true,
        planVersion,
        expected: {
          planning: { input: 1, direction: 1, style: 1, core: 1 },
          outline: 1,
          bindings: 1,
        },
        runs: [],
      } as unknown as PlannedRunReadiness),
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.current).toBe(planVersion === 1);
    if (planVersion === 2) expect(view.result.current.block).toContain('旧审核失效');
    else expect(view.result.current.block).toBeUndefined();
    view.unmount();
    client.clear();
  },
);

// Exercise the real pending-input provider: mocking its boolean misses the
// self-lock that prevented stale and adopted drafts from submitting rewrites.
it.each(['stale', 'committed'])(
  'submits %s rewrites with their own instruction, but blocks unrelated edits',
  async (status) => {
    const expected = {
      planning: { input: 1, direction: 1, style: 1, core: 1 },
      outline: 1,
      bindings: 1,
    };
    const run = {
      id: 'source',
      chapterId: 'draft',
      status,
      draftVersion: 4,
      planning: { mode: 'beat', planVersion: 1, expected },
    } as unknown as BackendRun;
    vi.spyOn(plannedRunApi, 'get').mockResolvedValue({
      ready: true,
      draftVersion: 4,
      planVersion: 1,
      expected,
      runs: [run],
    } as PlannedRunReadiness);
    vi.spyOn(trialApi, 'get').mockResolvedValue(run);
    vi.spyOn(plannedRunApi, 'draft').mockResolvedValue({
      draftVersion: 4,
      segments: [],
    } as unknown as StoredDraft);
    const start = vi
      .spyOn(plannedRunApi, 'start')
      .mockResolvedValue({ ...run, id: 'new', status: 'running' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(
      ({ other }) => {
        const owner = useId();
        useWritingPending(true, owner);
        useWritingPending(other);
        return usePlannedWriting('chapter', 'middle', false, owner);
      },
      {
        initialProps: { other: true },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <RouterProvider
              router={createMemoryRouter([
                { path: '/', element: <PendingWritingProvider>{children}</PendingWritingProvider> },
              ])}
            />
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(view.result.current.run?.id).toBe('source'));
    const rewrite = {
      segmentId: 's',
      segmentVersion: 4,
      original: '原文。',
      start: 0,
      end: 3,
      instruction: '改写此段',
    };
    expect(view.result.current.revisionBlock(true)).toContain('其他未保存');
    await act(async () => {
      expect(await view.result.current.revise(rewrite)).toBe(false);
    });
    expect(start).not.toHaveBeenCalled();
    view.rerender({ other: false });
    await waitFor(() => expect(view.result.current.revisionBlock(true)).toBe(''));
    expect(view.result.current.revisionBlock()).toContain('其他未保存');
    await act(async () => {
      expect(await view.result.current.revise(rewrite)).toBe(true);
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0]).toMatchObject({
      fromRunId: 'source',
      sourceVersion: 4,
      rewrite,
    });
    expect(start.mock.calls[0][0]).not.toHaveProperty('recheck');
    view.unmount();
    client.clear();
  },
);

it('keeps the adopted working run after dismissing a newer candidate and refreshing', async () => {
  const adopted = {
    id: 'adopted',
    chapterId: 'whole',
    status: 'committed',
    commitId: 'commit',
    draftVersion: 3,
  } as BackendRun;
  const candidate = {
    id: 'new',
    chapterId: 'beat',
    status: 'waiting_human',
    draftVersion: 1,
    canDismiss: true,
  } as BackendRun;
  let dismissed = false;
  vi.spyOn(plannedRunApi, 'get').mockImplementation(
    async () =>
      ({
        ready: true,
        runs: [{ ...candidate, dismissed }, adopted],
        working: {
          runId: dismissed ? adopted.id : candidate.id,
          version: dismissed ? 3 : 1,
          segments: [],
        },
      }) as unknown as PlannedRunReadiness,
  );
  vi.spyOn(trialApi, 'get').mockImplementation(async (id) =>
    id === adopted.id ? adopted : { ...candidate, dismissed },
  );
  vi.spyOn(plannedRunApi, 'draft').mockResolvedValue({ segments: [] } as unknown as StoredDraft);
  const discard = vi.spyOn(plannedRunApi, 'dismiss').mockImplementation(async () => {
    dismissed = true;
    return { ...candidate, dismissed: true, canDismiss: false };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => usePlannedWriting('chapter', 'middle', false), { wrapper });
  await waitFor(() => expect(view.result.current.run?.id).toBe('new'));
  await act(async () => {
    await view.result.current.dismiss.mutateAsync();
  });
  await waitFor(() => expect(view.result.current.run?.id).toBe('adopted'));
  expect(discard).toHaveBeenCalledWith('new', 1);
  view.unmount();
  const reopened = renderHook(() => usePlannedWriting('chapter', 'middle', false), { wrapper });
  await waitFor(() => expect(reopened.result.current.run?.id).toBe('adopted'));
  reopened.unmount();
  client.clear();
});
