import { backendApi } from '@/shared/api/client';
import type { StyleAnalysisJob } from '../types/style-analysis';
export const styleAnalysisKey = ['backend-style-analysis', 'zhuoliu', 'main'] as const;
export const styleAnalysisApi = {
  list: (signal?: AbortSignal) =>
    backendApi.get<StyleAnalysisJob[]>('/planning/style-analyses', signal),
  start: (body: { requestId: string; title: string; text: string }) =>
    backendApi.post<StyleAnalysisJob>('/planning/style-analyses', body),
};
