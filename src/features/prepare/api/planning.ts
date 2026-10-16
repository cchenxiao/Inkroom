import type {
  StyleTrialJob,
  StyleTrialRequest,
  StyleSelection,
  StyleSelectionRequest,
} from '../types/style-trial';
import { backendApi } from '@/shared/api/client';
import type {
  DirectionRequest,
  DirectionSelection,
  PlanningInput,
  PlanningIntake,
  PlanningJob,
  PlanningState,
} from '../types/planning';
export const planningKey = ['backend-planning', 'zhuoliu', 'main'] as const;
export const planningApi = {
  generateTrial: (body: StyleTrialRequest) =>
    backendApi.post<StyleTrialJob>('/planning/style-trials', body),
  selectStyle: (body: StyleSelectionRequest) =>
    backendApi.post<StyleSelection>('/planning/style-selection', body),
  get: (signal?: AbortSignal) => backendApi.get<PlanningState>('/planning', signal),
  save: (expectedVersion: number, intake: PlanningIntake) =>
    backendApi.patch<PlanningInput>('/planning/intake', { expectedVersion, intake }),
  generate: (requestId: string, expectedInputVersion: number) =>
    backendApi.post<PlanningJob>('/planning/jobs', { requestId, expectedInputVersion }),
  select: (body: DirectionRequest) =>
    backendApi.post<DirectionSelection>('/planning/selection', body),
};
