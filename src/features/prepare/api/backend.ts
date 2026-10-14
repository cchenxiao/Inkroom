import { backendApi } from '@/shared/api/client';
import type { BackendRun } from '../types/backend';

export const trialApi = {
  latest: () => backendApi.get<BackendRun>('/runs/latest'),
  start: () => backendApi.post<BackendRun>('/runs', { chapterId: 'ch7', branchId: 'main' }),
  get: (id: string) => backendApi.get<BackendRun>(`/runs/${encodeURIComponent(id)}`),
};
