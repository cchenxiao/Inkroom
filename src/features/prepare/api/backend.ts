import { backendApi } from '@/shared/api/client';
import type {
  BackendRun,
  BackendManifest,
  BackendCommit,
  FinalizeInput,
  HumanAction,
  StoredDraft,
  StoredVersion,
  ModelCall,
} from '../types/backend';

export const trialApi = {
  manifest: (id: string, signal?: AbortSignal) =>
    backendApi.get<BackendManifest>(`/runs/${encodeURIComponent(id)}/context-manifest`, signal),
  finalize: (id: string, input: FinalizeInput) =>
    backendApi.post<BackendCommit>(`/runs/${encodeURIComponent(id)}/commit`, input),
  commits: (signal?: AbortSignal) =>
    backendApi.get<BackendCommit[]>('/commits?chapterId=ch7&branchId=main', signal),
  action: (runId: string, action: HumanAction) =>
    backendApi.post<BackendRun>(`/runs/${encodeURIComponent(runId)}/actions`, action),
  health: () => backendApi.get<{ provider: string; model: string; scenarios: string[] }>('/health'),
  draft: (version?: number, signal?: AbortSignal) =>
    backendApi.get<StoredDraft>(
      `/chapters/ch7?branchId=main${version ? `&version=${version}` : ''}`,
      signal,
    ),
  versions: (signal?: AbortSignal) =>
    backendApi.get<StoredVersion[]>('/chapters/ch7/versions?branchId=main', signal),
  edit: (input: { id: string; text: string; draftVersion: number }) =>
    backendApi.patch<StoredDraft>(`/segments/${encodeURIComponent(input.id)}`, {
      chapterId: 'ch7',
      branchId: 'main',
      text: input.text,
      draftVersion: input.draftVersion,
    }),
  runs: (signal?: AbortSignal) => backendApi.get<BackendRun[]>('/runs', signal),
  calls: (id: string, signal?: AbortSignal) =>
    backendApi.get<ModelCall[]>(`/runs/${encodeURIComponent(id)}/calls`, signal),
  latest: () => backendApi.get<BackendRun>('/runs/latest'),
  start: (options: {
    draftVersion: number;
    autoRevise: boolean;
    allowLocalRewrite: boolean;
    scenario: string;
    maxRounds: 2 | 3;
  }) => backendApi.post<BackendRun>('/runs', { chapterId: 'ch7', branchId: 'main', ...options }),
  get: (id: string, signal?: AbortSignal) =>
    backendApi.get<BackendRun>(`/runs/${encodeURIComponent(id)}`, signal),
};
