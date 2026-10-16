import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from './client';
import { queryKeys, endpoints } from './endpoints';
import { useUIStore } from '@/shared/lib/ui-store';
import type { ChapterDocument, Project, Bible, Chapter, Branch } from '@/types/domain';
export function useResource<T>(path: string, enabled = true) {
  useUIStore((s) => s.projectId);
  return useQuery({ queryKey: queryKeys.resource(path), queryFn: () => api.get<T>(path), enabled });
}
export function useAction<T = unknown, P = unknown>(
  path: string,
  method: 'post' | 'patch' | 'delete' = 'post',
) {
  const client = useQueryClient();
  return useMutation<T, Error, P>({
    mutationFn: (payload: P) => {
      const scope = useUIStore.getState();
      const body =
        payload && typeof payload === 'object'
          ? { chapterId: scope.chapterId, branchId: scope.branchId, ...payload }
          : payload;
      return method === 'delete' ? api.delete<T>(path) : api[method]<T>(path, body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['library'] });
      void client.invalidateQueries({ queryKey: ['book-context'] });
      void client.invalidateQueries({ queryKey: queryKeys.all });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        useUIStore.getState().setStale(true);
        void client.invalidateQueries({ queryKey: queryKeys.all });
      }
      toast.error(error.message);
    },
  });
}
export function useProject() {
  const id = useUIStore((s) => s.projectId);
  return useResource<Project>(endpoints.project(id));
}
export function useTree() {
  const branch = useUIStore((s) => s.branchId);
  const projectId = useUIStore((s) => s.projectId);
  return useResource<Chapter[]>(endpoints.tree(projectId) + '?branchId=' + branch);
}
export function useBible() {
  const branch = useUIStore((s) => s.branchId);
  return useResource<Bible>(endpoints.bible() + '?branchId=' + branch);
}
export const useBranches = () => useResource<Branch[]>(endpoints.branches);
export function useChapter() {
  const chapterId = useUIStore((s) => s.chapterId);
  const branchId = useUIStore((s) => s.branchId);
  return useResource<ChapterDocument>(endpoints.chapter(chapterId, branchId), Boolean(chapterId));
}
