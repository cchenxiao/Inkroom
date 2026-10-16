import { backendApi } from '@/shared/api/client';
import type { ChapterReviewJob } from './chapter-review';
export interface FactCandidate {
  id: string;
  text: string;
  kind: 'event' | 'statement' | 'uncertain';
  relatedFactId: string;
  evidence: { ref: string; quote: string };
  reason: string;
}
export interface FactDecision {
  candidateId: string;
  action: 'confirm' | 'exclude' | 'keep_existing' | 'revise_manuscript';
  text: string;
  knownBy: string[];
  reason: string;
}
export interface FactsRequest {
  requestId: string;
  reviewId: string;
  inputDigest: string;
  mode: 'model' | 'manual';
}
export interface FactsSelectionRequest {
  requestId: string;
  jobId: string;
  expectedVersion: number;
  decisions: FactDecision[];
  manual: FactCandidate[];
}
export interface FactsPackage {
  baseKnowledge: { version: number; digest: string };
  facts: {
    id: string;
    text: string;
    chapterId: string;
    commitId: string;
    segmentId: string;
    sourceVersion: number;
    storyTime: number;
    evidence: { ref: string; quote: string };
    knownBy: string[];
  }[];
}
export interface FactsSelection {
  version: number;
  request: FactsSelectionRequest;
  package: FactsPackage;
  block: string;
  createdAt: string;
}
export interface FactsJob {
  id: string;
  request: FactsRequest;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  provider: string;
  model: string;
  message: string;
  input: {
    chapterId: string;
    review: ChapterReviewJob['input'];
    baseKnowledge: { version: number; digest: string };
    knowledge: { characters: string[]; facts: { id: string; text: string }[] };
  };
  output?: { candidates: FactCandidate[] };
  calls: ChapterReviewJob['calls'];
  createdAt: string;
}
export interface FactsState {
  job: FactsJob | null;
  selection: FactsSelection | null;
  current: boolean;
  published: boolean;
  block: string;
}
export const chapterFactsApi = {
  read: (reviewId: string, signal?: AbortSignal) =>
    backendApi.get<FactsState>(
      `/planning/chapter-reviews/${encodeURIComponent(reviewId)}/facts`,
      signal,
    ),
  start: (req: FactsRequest) => backendApi.post<FactsJob>('/planning/chapter-fact-jobs', req),
  save: (req: FactsSelectionRequest) =>
    backendApi.post<FactsSelection>('/planning/chapter-fact-selections', req),
};
