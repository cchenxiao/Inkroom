import { useQuery } from '@tanstack/react-query';
import { planningApi, planningKey } from '../api/planning';
export function usePlanning() {
  return useQuery({
    queryKey: planningKey,
    queryFn: ({ signal }) => planningApi.get(signal),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((j) => j.status === 'running') ? 1200 : false,
  });
}
