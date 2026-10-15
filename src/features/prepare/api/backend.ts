import { backendApi } from '@/shared/api/client';
import type { BackendRun } from '../types/backend';

export const trialApi = {
  health: () => backendApi.get<{ provider: string; model: string; scenarios: string[] }>('/health'),
  latest: () => backendApi.get<BackendRun>('/runs/latest'),
  start: (options: {
    autoRevise: boolean;
    allowLocalRewrite: boolean;
    scenario: string;
    maxRounds: 2 | 3;
  }) => backendApi.post<BackendRun>('/runs', { chapterId: 'ch7', branchId: 'main', ...options }),
  get: (id: string) => backendApi.get<BackendRun>(`/runs/${encodeURIComponent(id)}`),
};
