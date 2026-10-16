import { backendApi } from '@/shared/api/client';
import type {
  OutlineJob,
  OutlineStartRequest,
  OutlineSaveRequest,
  OutlineSelection,
} from '../types/outline';
export const outlineApi = {
  generate: (body: OutlineStartRequest) =>
    backendApi.post<OutlineJob>('/planning/outline-jobs', body),
  save: (body: OutlineSaveRequest) =>
    backendApi.post<OutlineSelection>('/planning/outline-selection', body),
};
