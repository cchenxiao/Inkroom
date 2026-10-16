import { useQueries } from '@tanstack/react-query';
import { plannedRunApi } from '../api/planned-run';

/** Read each beat independently: changing the active editor must not hide other candidates. */
export function useChapterCandidates(chapterId: string, beatIds: string[]) {
  return useQueries({
    queries: beatIds.map((beatId) => ({
      queryKey: ['planned-run-gate', chapterId, beatId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        plannedRunApi.get(chapterId, signal, beatId),
      enabled: Boolean(chapterId && beatId),
      retry: false,
      refetchInterval: 5000,
    })),
  });
}
