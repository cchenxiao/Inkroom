import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useAutosave } from '@/features/workspace/use-autosave';
import { workspaceApi } from '@/features/workspace/api';
import { ApiError } from '@/shared/api/client';
import { queryKeys, endpoints } from '@/shared/api/endpoints';
import { useUIStore } from '@/shared/lib/ui-store';
import { seedDocuments } from '@/mocks/data/seed';
import type { ChangeSet } from '@/types/domain';
const saved = (draftVersion: number) => ({ draftVersion, changeset: {} as ChangeSet });
beforeEach(() => {
  sessionStorage.clear();
  useUIStore.getState().setStale(false);
});
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const document = seedDocuments().ch7;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.resource(endpoints.chapter('ch7', 'main')), document);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { document, client, wrapper };
}
describe('version-aware segment autosave', () => {
  it('requires explicit reconciliation even if another control clears the global stale banner', async () => {
    const { document, wrapper } = fixture();
    const versions: number[] = [];
    vi.spyOn(workspaceApi, 'saveSegment').mockImplementation(async (_id, _text, base) => {
      versions.push(base);
      return saved(5);
    });
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, 'main'), {
      wrapper,
      initialProps: { doc: document },
    });
    act(() => result.current.change('ch7-s1', 'author local text'));
    rerender({ doc: { ...document, chapter: { ...document.chapter, draftVersion: 4 } } });
    act(() => useUIStore.getState().setStale(false));
    await act(() => result.current.flush());
    expect(versions).toEqual([]);
    act(() => result.current.acknowledgeRefresh());
    await act(() => result.current.flush());
    expect(versions).toEqual([]);
    act(() => result.current.reconcileToLatest());
    await act(() => result.current.flush());
    expect(versions).toEqual([4]);
    expect(result.current.drafts).toEqual({});
  });
  it('stops queued typing if an external update overtakes an in-flight save', async () => {
    const { document, wrapper, client } = fixture();
    let finish!: (value: ReturnType<typeof saved>) => void;
    const versions: number[] = [];
    vi.spyOn(workspaceApi, 'saveSegment').mockImplementation(async (_id, _text, base) => {
      versions.push(base);
      if (versions.length === 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return saved(6);
    });
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, 'main'), {
      wrapper,
      initialProps: { doc: document },
    });
    act(() => result.current.change('ch7-s1', 'first'));
    let request!: Promise<void>;
    act(() => {
      request = result.current.flush();
    });
    act(() => result.current.change('ch7-s1', 'second'));
    const remote = { ...document, chapter: { ...document.chapter, draftVersion: 5 } };
    client.setQueryData(queryKeys.resource(endpoints.chapter('ch7', 'main')), remote);
    rerender({ doc: remote });
    await act(async () => {
      finish(saved(4));
      await request;
    });
    expect(versions).toEqual([3]);
    expect(useUIStore.getState().stale).toBe(true);
    expect(result.current.drafts['ch7-s1']).toBe('second');
    expect(
      client.getQueryData<typeof document>(queryKeys.resource(endpoints.chapter('ch7', 'main')))!
        .chapter.draftVersion,
    ).toBe(5);
  });

  it('does not rebase queued edits onto a background refetch', async () => {
    const { document, wrapper } = fixture();
    const save = vi.spyOn(workspaceApi, 'saveSegment').mockResolvedValue(saved(5));
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, 'main'), {
      wrapper,
      initialProps: { doc: document },
    });
    act(() => result.current.change('ch7-s1', 'local v3 text'));
    rerender({ doc: { ...document, chapter: { ...document.chapter, draftVersion: 4 } } });
    expect(useUIStore.getState().stale).toBe(true);
    await act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();
    expect(result.current.drafts['ch7-s1']).toBe('local v3 text');
  });
  it('restores the original base version and blocks a backup from an older manuscript', async () => {
    const { document, wrapper } = fixture();
    sessionStorage.setItem(
      'inkloom-draft:main:ch7',
      JSON.stringify({ baseVersion: 3, drafts: { 'ch7-s1': 'restored edit' } }),
    );
    const save = vi.spyOn(workspaceApi, 'saveSegment').mockResolvedValue(saved(5));
    const { result } = renderHook(
      () => useAutosave({ ...document, chapter: { ...document.chapter, draftVersion: 4 } }, 'main'),
      { wrapper },
    );
    expect(result.current.drafts['ch7-s1']).toBe('restored edit');
    expect(useUIStore.getState().stale).toBe(true);
    await act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });
  it('requires reconciliation for a legacy backup with an unknown base version', async () => {
    const { document, wrapper } = fixture();
    sessionStorage.setItem('inkloom-draft:main:ch7', JSON.stringify({ 'ch7-s1': 'legacy edit' }));
    const { result } = renderHook(() => useAutosave(document, 'main'), { wrapper });
    expect(result.current.drafts['ch7-s1']).toBe('legacy edit');
    expect(useUIStore.getState().stale).toBe(true);
  });

  it('preserves typed text and blocks further saves after a 409', async () => {
    const { document, wrapper } = fixture();
    vi.spyOn(workspaceApi, 'saveSegment').mockRejectedValue(
      new ApiError(409, { code: 'version_mismatch', message: 'stale', currentVersion: 4 }),
    );
    const { result } = renderHook(() => useAutosave(document, 'main'), { wrapper });
    act(() => result.current.change('ch7-s1', 'Local revised text'));
    await act(() => result.current.flush());
    expect(result.current.status).toBe('failed');
    expect(result.current.drafts['ch7-s1']).toBe('Local revised text');
    expect(useUIStore.getState().stale).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('inkloom-draft:main:ch7')!).drafts['ch7-s1']).toBe(
      'Local revised text',
    );
  });
  it('keeps later typing while an earlier request is in flight and advances its version', async () => {
    const { document, wrapper, client } = fixture();
    let resolveFirst!: (value: ReturnType<typeof saved>) => void;
    const versions: number[] = [];
    vi.spyOn(workspaceApi, 'saveSegment').mockImplementation(async (_id, _text, version) => {
      versions.push(version);
      if (versions.length === 1)
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      return saved(5);
    });
    const { result } = renderHook(() => useAutosave(document, 'main'), { wrapper });
    act(() => result.current.change('ch7-s1', 'first edit'));
    let request!: Promise<void>;
    act(() => {
      request = result.current.flush();
    });
    act(() => result.current.change('ch7-s1', 'second edit'));
    await act(async () => {
      resolveFirst(saved(4));
      await request;
    });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(versions).toEqual([3, 4]);
    expect(result.current.drafts).toEqual({});
    const cached = client.getQueryData<typeof document>(
      queryKeys.resource(endpoints.chapter('ch7', 'main')),
    )!;
    expect(cached.chapter.draftVersion).toBe(5);
    expect(cached.segments[0].text).toBe('second edit');
  });
});
