import { backendApi } from '@/shared/api/client';
import type { ChapterReviewJob } from './chapter-review';
import type { ChapterAssembly } from './chapter-assembly';

export interface ChapterPublicationRequest {
  requestId: string;
  reviewId: string;
  assemblyVersion: number;
  inputDigest: string;
  approvalId: string;
  noPendingFacts: boolean;
}
export interface ChapterPublication {
  id: string;
  scope: string;
  chapterId: string;
  version: number;
  parentPublicationId?: string;
  request: ChapterPublicationRequest;
  assembly: ChapterAssembly;
  review: ChapterReviewJob;
  factConfirmation: {
    draftVersion: number;
    method: 'author_no_pending_facts';
    noPendingFacts: boolean;
  };
  createdAt: string;
}
export interface ChapterPublicationState {
  publication: ChapterPublication | null;
  current: boolean;
  reason: string;
}
export const chapterPublicationApi = {
  read: (reviewId: string, signal?: AbortSignal) =>
    backendApi.get<ChapterPublicationState>(
      `/planning/chapter-reviews/${encodeURIComponent(reviewId)}/publication`,
      signal,
    ),
  publish: (request: ChapterPublicationRequest) =>
    backendApi.post<ChapterPublicationState>('/planning/chapter-publications', request),
};
