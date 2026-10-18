import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/api/client';
import type { FactsPackage } from './chapter-facts';
import type { ChapterReviewJob } from './chapter-review';
export interface BookArchive {
  scope: string;
  characters: Record<string, string>;
  initialFacts: {
    id: string;
    text: string;
    storyTime: number | null;
    knownBy: { characterId: string; learnedAt: number | null }[];
  }[];
  chapters: {
    statistics?: {
      mean: number;
      variance: number;
      burstiness: number;
      sentenceLengths: number[];
      calibrated: boolean;
    };
    number: number;
    chapterId: string;
    title: string;
    publicationId: string;
    version: number;
    current: boolean;
    reason: string;
    text: string;
    reviewId: string;
    facts: FactsPackage['facts'];
    findings: NonNullable<ChapterReviewJob['output']>['critics'][number]['findings'];
    keptFindings: string[];
  }[];
}
export function useBookArchive(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['book-archive', 'zhuoliu', 'main'],
    queryFn: ({ signal }) => backendApi.get<BookArchive>('/planning/archive', signal),
    staleTime: 30000,
    retry: false,
  });
}
