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
  enhancedContinuity?: boolean;
  requestId: string;
  assemblyId: string;
  assemblyVersion: number;
  assemblyDigest: string;
}
export interface ChapterReviewDecision {
  keptFindings?: string[];
  requestId: string;
  assemblyVersion: number;
  inputDigest: string;
  action: 'approve' | 'request_changes';
  reason: string;
  createdAt?: string;
}
export interface ChapterReviewFailure {
  stage: string;
  code: string;
  message: string;
  finding?: number;
}
export interface ChapterReviewJob {
  failure?: ChapterReviewFailure;
  id: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  provider: string;
  model: string;
  inputDigest: string;
  input: {
    enhancedContinuity?: boolean;
    assemblyId: string;
    draftVersion: number;
    assemblyDigest: string;
    parts: ReviewPart[];
  };
  output?: {
    critics: {
      critic: string;
      status: string;
      error?: string;
      failure?: ChapterReviewFailure;
      findings: (BackendFinding & { evidence: { ref: string; quote: string }[] })[];
    }[];
  };
  message: string;
  current: boolean;
  approvalBlock: string;
  canApproveAfterJudgement?: boolean;
  createdAt: string;
  decision?: ChapterReviewDecision;
  calls: {
    startedAt?: string;
    timeoutMs?: number;
    activity?: string;
    number: number;
    role: string;
    phase: string;
    success?: boolean;
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
