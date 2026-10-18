import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/api/client';
import { useLiveBook } from '@/features/library/api/live-book';
import { useBookArchive } from '@/features/prepare/api/book-archive';
import type { BookArchive } from '@/features/prepare/api/book-archive';
import type { ReportOverview, Finding } from '@/types/domain';
export interface BookQuality {
  scope: string;
  chapters: {
    chapterId: string;
    title: string;
    words: number;
    statistics: NonNullable<BookArchive['chapters'][number]['statistics']>;
    findings: (Finding & { beatId: string; runId: string; kept: boolean })[];
  }[];
  runs: {
    id: string;
    chapterId: string;
    beatId: string;
    status: string;
    mode: string;
    model: string;
    error: string;
    tokens: number;
    tokensKnown: boolean;
    reviseRound: number;
    autoRevise: boolean;
    lookup: boolean;
    createdAt: string;
  }[];
}
export function useLiveReports(enabled: boolean) {
  const book = useLiveBook(enabled);
  const archive = useBookArchive(enabled);
  const quality = useQuery({
    queryKey: ['book-quality'],
    enabled,
    retry: false,
    queryFn: ({ signal }) => backendApi.get<BookQuality>('/planning/quality', signal),
    staleTime: 5000,
  });
  const data: ReportOverview | undefined =
    quality.data && book.data
      ? {
          chapterStats: quality.data.chapters.map((c) => ({
            chapter: `第${book.data!.chapters.find((ch) => ch.id === c.chapterId)?.number ?? ''}章 ${c.title}`,
            status: 'drafting',
            words: c.words,
            style: null,
            aiTaste: null,
          })),
          foreshadowRate: null,
          voiceScores: [],
          sentenceDistribution: [10, 20, 30, 40, 60, Infinity].map((max, i, a) => ({
            range: `${i ? a[i - 1] + 1 : 1}${max === Infinity ? '+' : '–' + max}`,
            count: quality
              .data!.chapters.flatMap((c) => c.statistics.sentenceLengths)
              .filter((n) => n > (a[i - 1] ?? 0) && n <= max).length,
          })),
          samples: quality.data.chapters.flatMap((c) =>
            c.findings.map((f) => ({
              id: `${f.runId}/${f.id}`,
              title: `${c.title} · ${f.severity}`,
              quote: f.quote,
              reason: f.reason,
              chapterId: c.chapterId,
              beatId: f.beatId,
              kept: f.kept,
            })),
          ),
        }
      : undefined;
  return {
    book,
    archive,
    quality,
    data,
    error: quality.error || book.error || archive.error,
    loading: enabled && (quality.isPending || book.isPending || archive.isPending),
    refresh: () => Promise.all([quality.refetch(), book.refetch(), archive.refetch()]),
  };
}
export type LiveReports = ReturnType<typeof useLiveReports>;
