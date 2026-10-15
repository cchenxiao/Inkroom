import type { Finding, RunState } from '@/types/domain';

/** I3 结果是隔离的单段候选，不是工作台正式稿本。 */
export interface BackendRun extends Omit<RunState, 'status' | 'currentNode'> {
  lookup?: LookupTrace;
  criticLookups?: {
    draftVersion: number;
    inputDigest: string;
    review: {
      critic: string;
      draftVersion: number;
      status: string;
      lookup?: LookupTrace;
      evidence?: {
        hits: {
          record: {
            id: string;
            version: number;
            kind: 'fact' | 'passage';
            text: string;
            knowledge?: { version: number; digest: string };
          };
          digest: string;
        }[];
      };
    };
  }[];
  inputDigest?: string;
  commitId?: string;
  eventSequence: number;
  activeRoles: string[];
  status: RunState['status'] | 'needs_human' | 'stale' | 'interrupted' | 'approved' | 'committed';
  canResume: boolean;
  approvalBlock?: string;
  instructionBlock?: string;
  pendingAction?: HumanAction;
  currentNode: string;
  baseDraftVersion: number;
  createdAt: string;
  allowLocalRewrite: boolean;
  scenario: string;
  autoRevise: boolean;
  provider: string;
  model: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; known: boolean };
  result?: {
    nodePhase?: 'started' | 'finished';
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

export interface StoredDraft {
  chapterId: string;
  branchId: string;
  draftVersion: number;
  segments: { id: string; text: string; version: number }[];
  findings: BackendFinding[];
  reviewed: boolean;
  origin: string;
  createdAt: string;
}
export interface StoredVersion {
  draftVersion: number;
  origin: string;
  createdAt: string;
}
export interface ModelCall {
  number: number;
  role: string;
  purpose: string;
  promptVersion: string;
  phase: 'started' | 'finished' | 'unknown';
  success: boolean;
  elapsedMs: number;
  usage: { inputTokens: number; outputTokens: number; known: boolean };
}

export interface HumanAction {
  id: string;
  type: 'approve' | 'instruct' | 'inline_edit';
  draftVersion: number;
  instruction?: string;
  segmentId?: string;
  text?: string;
}

export interface BackendRunEvent {
  runId: string;
  sequence: number;
  type: string;
  createdAt: string;
  run: BackendRun;
}

export interface BackendManifest {
  runId: string;
  projectId: string;
  chapterId: string;
  branchId: string;
  baseDraftVersion: number;
  assemblerVersion: string;
  digest: string;
  tokenEstimate: number;
  budget: number;
  reservedOutputTokens: number;
  sources: {
    id: string;
    kind: string;
    title: string;
    version: number;
    digest: string;
    method: 'direct' | 'keyword' | 'hybrid_fake' | 'hybrid_zhipu';
    tokens: number;
    excerpt: string;
  }[];
  excluded: { title: string; reason: string }[];
}
export interface FinalizeInput {
  id: string;
  draftVersion: number;
  inputDigest: string;
  factsConfirmed: boolean;
}
export interface BackendCommit {
  id: string;
  runId: string;
  projectId: string;
  chapterId: string;
  branchId: string;
  draftVersion: number;
  parentCommit?: string;
  approvalActionId: string;
  inputDigest: string;
  createdAt: string;
  factConfirmation: {
    draftVersion: number;
    method: 'author_no_pending_facts';
    noPendingFacts: boolean;
  };
  manifest: BackendManifest;
  segments: { id: string; text: string; version: number }[];
  refs: { kind: string; id: string; version: number; digest: string; payload: unknown }[];
}

export interface LookupTrace {
  steps: {
    callId: string;
    query: string;
    status: string;
    newSources: number;
    refs: { id: string; version: number; digest: string }[];
  }[];
  stop?: string;
}
