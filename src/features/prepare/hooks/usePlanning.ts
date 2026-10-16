import { useUIStore } from '@/shared/lib/ui-store';
import { useQuery } from '@tanstack/react-query';
import { planningApi, planningKey } from '../api/planning';
export function usePlanning() {
  const projectId = useUIStore((s) => s.projectId);
  const branchId = useUIStore((s) => s.branchId);
  return useQuery({
    enabled: projectId === 'project-zhuoliu' && branchId === 'main',
    queryKey: planningKey,
    queryFn: ({ signal }) => planningApi.get(signal),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.outlineJobs?.some((j) => j.status === 'running') ||
      query.state.data?.coreJobs?.some((j) => j.status === 'running') ||
      query.state.data?.jobs.some((j) => j.status === 'running') ||
      query.state.data?.styleJobs?.some((j) => j.report.status === 'running')
        ? 1200
        : false,
  });
}
