import type { Finding, RunState } from '@/types/domain';

/** I3 结果是隔离的单段候选，不是工作台正式稿本。 */
export interface BackendRun extends Omit<RunState, 'status' | 'currentNode'> {
  status: RunState['status'] | 'needs_human';
  currentNode: string;
  allowLocalRewrite: boolean;
  scenario: string;
  autoRevise: boolean;
  provider: string;
  model: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; known: boolean };
  result?: {
    route: {
      kind: string;
      targetIds: string[];
      findingIds: string[];
      needsHuman: boolean;
      reason: string;
    };
    criticReviews: {
      critic: string;
      draftVersion: number;
      status: string;
      findings: BackendFinding[];
      error?: string;
    }[];
    context: {
      beat: { id: string; version: number; locked: boolean };
      characters: {
        id: string;
        name: string;
        version: number;
        hardTraits: FactSource[];
        knows: FactSource[];
      }[];
      facts: FactSource[];
      sources: FactSource[];
    };
    draftVersion: number;
    stopReason?: string;
    status: string;
    reviews: {
      draftVersion: number;
      findings: BackendFinding[];
    }[];
    revisions: {
      kind: string;
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
      findings: BackendFinding[];
    };
  };
}

export interface FactSource {
  id: string;
  version: number;
  text: string;
}
export type BackendFinding = Pick<
  Finding,
  | 'id'
  | 'critic'
  | 'severity'
  | 'segmentId'
  | 'quote'
  | 'reason'
  | 'suggestion'
  | 'repairScope'
  | 'evidenceRefs'
> & {
  ruleRef?: string;
  ruleQuote?: string;
  evidenceStatus?: 'confirmed' | 'uncertain';
  possibleDialogueLie?: boolean;
  requiresHuman?: boolean;
};
