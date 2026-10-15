import type { Finding, RunState } from '@/types/domain';

/** I3 结果是隔离的单段候选，不是工作台正式稿本。 */
export interface BackendRun extends RunState {
  autoRevise: boolean;
  provider: string;
  model: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; known: boolean };
  result?: {
    draftVersion: number;
    stopReason?: string;
    status: string;
    reviews: {
      draftVersion: number;
      findings: Pick<Finding, 'id' | 'severity' | 'quote' | 'reason' | 'suggestion'>[];
    }[];
    revisions: {
      round: number;
      fromVersion: number;
      toVersion: number;
      patches: {
        findingId: string;
        segmentId: string;
        oldText: string;
        newText: string;
        reason: string;
      }[];
    }[];
    metrics: {
      segmentId: string;
      mean: number;
      variance: number;
      burstiness: number;
      calibrated: boolean;
      sentenceLengths: number[];
      hits: { phrase: string; count: number }[];
    }[];
    segments: { id: string; text: string; version: number }[];
    report: {
      draftVersion: number;
      findings: Pick<Finding, 'id' | 'severity' | 'quote' | 'reason' | 'suggestion'>[];
    };
  };
}
