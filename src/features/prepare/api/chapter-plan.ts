import { backendApi } from '@/shared/api/client';
import type {
  ChapterPlanJob,
  ChapterPlanStartRequest,
  ChapterPlanSaveRequest,
  ChapterPlanSelection,
} from '../types/chapter-plan';
export const chapterPlanApi = {
  generate: (body: ChapterPlanStartRequest) =>
    backendApi.post<ChapterPlanJob>('/planning/chapter-plan-jobs', body),
  save: (body: ChapterPlanSaveRequest) =>
    backendApi.post<ChapterPlanSelection>('/planning/chapter-plan-selection', body),
};
