import { backendApi } from '@/shared/api/client';
import type { BackendRun, StoredDraft } from '../types/backend';
import type { ChapterPlanVersions } from '../types/chapter-plan';
export interface PlannedRunReadiness {
  ready: boolean;
  reason: string;
  draftId: string;
  draftVersion: number;
  planVersion: number;
  expected: ChapterPlanVersions;
  runs: BackendRun[];
}
export interface PlannedRunRequest {
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
  get: (chapterId: string, signal?: AbortSignal) =>
    backendApi.get<PlannedRunReadiness>(
      `/planning/chapter-runs?chapterId=${encodeURIComponent(chapterId)}`,
      signal,
    ),
  start: (request: PlannedRunRequest) =>
    backendApi.post<BackendRun>('/planning/chapter-runs', request),
};
