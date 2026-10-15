import { backendApi } from '@/shared/api/client';
import type {
  BackendRun,
  HumanAction,
  StoredDraft,
  StoredVersion,
  ModelCall,
} from '../types/backend';

export const trialApi = {
  action: (runId: string, action: HumanAction) =>
    backendApi.post<BackendRun>(`/runs/${encodeURIComponent(runId)}/actions`, action),
  health: () => backendApi.get<{ provider: string; model: string; scenarios: string[] }>('/health'),
  draft: (version?: number) =>
    backendApi.get<StoredDraft>(
      `/chapters/ch7?branchId=main${version ? `&version=${version}` : ''}`,
    ),
  versions: () => backendApi.get<StoredVersion[]>('/chapters/ch7/versions?branchId=main'),
  edit: (input: { id: string; text: string; draftVersion: number }) =>
    backendApi.patch<StoredDraft>(`/segments/${encodeURIComponent(input.id)}`, {
      chapterId: 'ch7',
      branchId: 'main',
      text: input.text,
      draftVersion: input.draftVersion,
    }),
  runs: () => backendApi.get<BackendRun[]>('/runs'),
  calls: (id: string) => backendApi.get<ModelCall[]>(`/runs/${encodeURIComponent(id)}/calls`),
  latest: () => backendApi.get<BackendRun>('/runs/latest'),
  start: (options: {
    draftVersion: number;
    autoRevise: boolean;
    allowLocalRewrite: boolean;
    scenario: string;
    maxRounds: 2 | 3;
  }) => backendApi.post<BackendRun>('/runs', { chapterId: 'ch7', branchId: 'main', ...options }),
  get: (id: string) => backendApi.get<BackendRun>(`/runs/${encodeURIComponent(id)}`),
};
