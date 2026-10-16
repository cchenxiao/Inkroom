import { backendApi } from '@/shared/api/client';
import type { BackendFinding } from '../types/backend';
export interface ReviewSource {
  id: string;
  kind: 'passage' | 'fact';
  text: string;
  sourceId: string;
  sourceVersion: number;
}
export interface ReviewPart {
  beatId: string;
  sceneId: string;
  title: string;
  commitId: string;
  pov: string;
  storyTime: number;
  segments: ReviewSource[];
  facts: ReviewSource[];
}
export interface ChapterReviewRequest {
  requestId: string;
  assemblyId: string;
  assemblyVersion: number;
  assemblyDigest: string;
}
export interface ChapterReviewDecision {
  requestId: string;
  assemblyVersion: number;
  inputDigest: string;
  action: 'approve' | 'request_changes';
  reason: string;
  createdAt?: string;
}
export interface ChapterReviewJob {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  provider: string;
  model: string;
  inputDigest: string;
  input: { assemblyId: string; draftVersion: number; assemblyDigest: string; parts: ReviewPart[] };
  output?: {
    critics: {
      critic: string;
      status: string;
      error?: string;
      findings: (BackendFinding & { evidence: { ref: string; quote: string }[] })[];
    }[];
  };
  message: string;
  current: boolean;
  approvalBlock: string;
  createdAt: string;
  decision?: ChapterReviewDecision;
  calls: {
    number: number;
    role: string;
    phase: string;
    elapsedMs: number;
    promptVersion: string;
    schemaVersion: string;
    usage: { inputTokens: number; outputTokens: number; known: boolean };
  }[];
}
export interface ChapterReviewState {
  current: boolean;
  reason: string;
  jobs: ChapterReviewJob[];
}
export const chapterReviewApi = {
  list: (assemblyId: string, signal?: AbortSignal) =>
    backendApi.get<ChapterReviewState>(
      `/planning/chapter-reviews?assemblyId=${encodeURIComponent(assemblyId)}`,
      signal,
    ),
  start: (request: ChapterReviewRequest) =>
    backendApi.post<ChapterReviewJob>('/planning/chapter-reviews', request),
  decide: (id: string, request: ChapterReviewDecision) =>
    backendApi.post<ChapterReviewJob>(
      `/planning/chapter-reviews/${encodeURIComponent(id)}/decisions`,
      request,
    ),
};
