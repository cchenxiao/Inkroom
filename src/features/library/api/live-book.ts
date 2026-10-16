import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/api/client';
import type { LiveBook } from '@/types/domain/live-book';
export const liveBookKey = ['live-book', 'zhuoliu', 'main'] as const;
export function useLiveBook() {
  return useQuery({
    queryKey: liveBookKey,
    queryFn: ({ signal }) => backendApi.get<LiveBook>('/planning/overview', signal),
    retry: false,
    refetchInterval: 5000,
  });
}
