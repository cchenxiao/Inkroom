import { useUIStore } from '@/shared/lib/ui-store';
export const endpoints = {
  project: (id = 'project-zhuoliu') => `/projects/${id}`,
  tree: (id = 'project-zhuoliu') => `/projects/${id}/tree`,
  chapter: (id: string, branch = 'main', version?: number) =>
    `/chapters/${id}?branchId=${branch}${version ? `&version=${version}` : ''}`,
  bible: (kind = 'all') => `/bible/${kind}`,
  runs: '/runs',
  run: (id: string) => `/runs/${id}`,
  actions: (id: string) => `/runs/${id}/actions`,
  events: (id: string) => `/runs/${id}/events`,
  context: (id: string) => `/runs/${id}/context-manifest`,
  preview: '/changesets/preview',
  changes: '/changesets',
  conflicts: '/conflicts',
  commits: '/commits',
  branches: '/branches',
  comments: '/comments',
  reports: '/reports',
};
export const queryKeys = {
  all: ['inkloom'] as const,
  resource: (path: string) =>
    useUIStore.getState().projectId === 'project-zhuoliu'
      ? (['inkloom', path] as const)
      : (['inkloom', path, useUIStore.getState().projectId] as const),
};
