import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { queryKeys } from '@/shared/api/endpoints';
import type {
  BookBrief,
  BookOverview,
  BookPlan,
  BookSummary,
  PlanAction,
} from '@/types/domain/library';
export const libraryKeys = {
  all: ['library'] as const,
  book: (id: string) => ['library', id] as const,
  plan: (id: string) => ['library', id, 'plan'] as const,
};
export const libraryApi = {
  list: () => api.get<BookSummary[]>('/projects'),
  overview: (id: string, branchId = 'main') =>
    api.get<BookOverview>(`/projects/${id}/overview?branchId=${encodeURIComponent(branchId)}`),
  create: (brief: BookBrief) => api.post<BookPlan>('/projects', brief),
  plan: (id: string) => api.get<BookPlan>(`/projects/${id}/planning`),
  update: (id: string, version: number, action: PlanAction) =>
    api.patch<BookPlan>(`/projects/${id}/planning`, { expectedVersion: version, ...action }),
};
export function useLibrary() {
  return useQuery({ queryKey: libraryKeys.all, queryFn: libraryApi.list });
}
export function useBook(id: string) {
  const branch = useUIStore((s) => (s.projectId === id ? s.branchId : 'main'));
  return useQuery({
    queryKey: [...libraryKeys.book(id), branch],
    queryFn: () => libraryApi.overview(id, branch),
    enabled: !!id,
    retry: false,
  });
}
export function useBookPlan(id: string) {
  return useQuery({
    queryKey: libraryKeys.plan(id),
    queryFn: () => libraryApi.plan(id),
    enabled: !!id,
    retry: false,
  });
}
export function usePlanAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ version, action }: { version: number; action: PlanAction }) =>
      libraryApi.update(id, version, action),
    onSuccess: (plan) => {
      client.setQueryData(libraryKeys.plan(id), plan);
      void client.invalidateQueries({ queryKey: ['book-context'] });
      void client.invalidateQueries({ queryKey: libraryKeys.all });
      void client.invalidateQueries({ queryKey: queryKeys.all });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: libraryKeys.plan(id) });
    },
  });
}
