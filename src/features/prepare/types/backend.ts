import type { Finding, RunState } from '@/types/domain';

/** I3 结果是隔离的单段候选，不是工作台正式稿本。 */
export interface BackendRun extends RunState {
  provider: string;
  model: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; known: boolean };
  result?: {
    draftVersion: number;
    segments: { id: string; text: string; version: number }[];
    report: {
      findings: Pick<Finding, 'id' | 'severity' | 'quote' | 'reason' | 'suggestion'>[];
    };
  };
}
