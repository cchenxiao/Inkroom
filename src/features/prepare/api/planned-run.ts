import { backendApi } from '@/shared/api/client';
import type { AuthorRewrite, BackendRun, StoredDraft } from '../types/backend';
import type { ChapterPlanVersions } from '../types/chapter-plan';
export interface PlannedRunReadiness {
  working?: {
    runId: string;
    version: number;
    state?: 'candidate' | 'adopted';
    segments: StoredDraft['segments'];
  };
  beatId: string;
  ready: boolean;
  reason: string;
  draftId: string;
  draftVersion: number;
  planVersion: number;
  expected: ChapterPlanVersions;
  runs: BackendRun[];
}
export interface PlannedRunRequest {
  mode?: 'beat' | 'chapter';
  fromRunId?: string;
  sourceVersion?: number;
  rewrite?: AuthorRewrite;
  recheck?: boolean;
  beatId?: string;
  requestId: string;
  chapterId: string;
  expected: ChapterPlanVersions;
  planVersion: number;
  draftVersion: number;
  autoRevise: boolean;
}
export const plannedRunApi = {
  draft: (id: string, signal?: AbortSignal) =>
    backendApi.get<StoredDraft>(`/chapters/${encodeURIComponent(id)}?branchId=main`, signal),
  get: (chapterId: string, signal?: AbortSignal, beatId?: string, mode?: 'chapter') =>
    backendApi.get<PlannedRunReadiness>(
      `/planning/chapter-runs?chapterId=${encodeURIComponent(chapterId)}&beatId=${encodeURIComponent(beatId ?? '')}${mode ? '&mode=' + mode : ''}`,
      signal,
    ),
  start: (request: PlannedRunRequest) =>
    backendApi.post<BackendRun>('/planning/chapter-runs', request),
};
