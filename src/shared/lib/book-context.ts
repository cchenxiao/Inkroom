import { useUIStore } from './ui-store';
export const ORIGINAL_PROJECT = 'project-zhuoliu';
export function bookPath(id: string) {
  const state = useUIStore.getState();
  const branch =
    state.projectId === id && state.branchId !== 'main'
      ? `?branchId=${encodeURIComponent(state.branchId)}`
      : '';
  return `/book/${encodeURIComponent(id)}${branch}`;
}
export function workPath(page: string, projectId: string, chapterId?: string, section?: string) {
  const query = new URLSearchParams({ projectId });
  const current = useUIStore.getState();
  if (current.projectId === projectId) query.set('branchId', current.branchId);
  if (chapterId) query.set('chapterId', chapterId);
  if (section) query.set('section', section);
  return `/${page}?${query}`;
}
export function enterBook(projectId: string, chapterId = '', branchId = 'main') {
  useUIStore.getState().setProject(projectId, chapterId, branchId);
}
