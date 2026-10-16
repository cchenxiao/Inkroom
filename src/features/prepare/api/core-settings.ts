import { backendApi } from '@/shared/api/client';
import type {
  CoreStartRequest,
  CoreJob,
  CoreSaveRequest,
  CoreSelection,
} from '../types/core-settings';
export const coreSettingsApi = {
  generate: (body: CoreStartRequest) => backendApi.post<CoreJob>('/planning/core-jobs', body),
  save: (body: CoreSaveRequest) => backendApi.post<CoreSelection>('/planning/core-selection', body),
};
