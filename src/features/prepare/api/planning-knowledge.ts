import { backendApi } from '@/shared/api/client';
import type { StoredKnowledge } from '../types/knowledge';
import type { PlanningVersions } from '../types/outline';
export interface KnowledgePreview {
  ready: boolean;
  reason: string;
  expected: PlanningVersions;
  expectedVersion: number;
  previewDigest: string;
  replacesTeaching: boolean;
  currentVersion: number;
  current: boolean;
  snapshot: StoredKnowledge['snapshot'] | null;
  excluded: { id: string; reason: string }[];
}
export interface KnowledgePublishRequest {
  expected: PlanningVersions;
  expectedVersion: number;
  previewDigest: string;
  confirm: boolean;
  reason: string;
}
export const publicationKey = ['planning-knowledge-preview'] as const;
export const planningKnowledgeApi = {
  preview: (signal?: AbortSignal) =>
    backendApi.get<KnowledgePreview>('/planning/knowledge-preview', signal),
  publish: (body: KnowledgePublishRequest) =>
    backendApi.post<StoredKnowledge>('/planning/knowledge-publications', body),
};
