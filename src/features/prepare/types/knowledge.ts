/** 与 Go knowledge.Snapshot / postgres.StoredKnowledge 对应；不复用 Mock Bible。 */
export interface KnowledgeLocation {
  initial?: { id: string; coreVersion: number; coreDigest: string };
  chapterId: string;
  segmentId: string;
  at: { chapter: number; storyTime: number };
}
export interface KnowledgeFact {
  id: string;
  version: number;
  text: string;
  source: KnowledgeLocation;
}
export interface KnowledgeInfo {
  factId: string;
  subjectId: string;
  state: 'known' | 'belief';
  source: KnowledgeLocation;
  belief?: string;
}
export interface KnowledgeEvent {
  id: string;
  summary: string;
  source: KnowledgeLocation;
  factIds: string[] | null;
  causalBefore: string[] | null;
}
export interface KnowledgeForeshadow {
  id: string;
  title: string;
  planted: KnowledgeLocation;
  payload: string;
  planResolveChapter: number;
  status: 'open' | 'closed' | 'abandoned';
  importance: 'P0' | 'P1' | 'P2';
  resolved?: KnowledgeLocation;
  abandonReason?: string;
}
export interface StoredKnowledge {
  digest: string;
  origin: 'human' | 'teaching_seed';
  reason: string;
  createdAt: string;
  snapshot: {
    planning?: {
      input: number;
      direction: number;
      style: number;
      core: number;
      coreDigest: string;
    };
    projectId: string;
    branchId: string;
    version: number;
    confirmed: boolean;
    characters: string[] | null;
    facts: KnowledgeFact[] | null;
    timeline: KnowledgeEvent[] | null;
    information: KnowledgeInfo[] | null;
    foreshadows: KnowledgeForeshadow[] | null;
  };
}
