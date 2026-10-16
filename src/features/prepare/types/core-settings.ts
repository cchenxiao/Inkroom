import type { DirectionSelection, PlanningInput, PlanningJob } from './planning';
import type { StyleSelection } from './style-trial';
export type CoreDecision = 'pending' | 'confirmed' | 'rejected';
export interface CharacterDesign {
  id: string;
  name: string;
  role: string;
  want: string;
  need: string;
  flaw: string;
  arcIntent: string;
  voice: string[];
  hardFactIds: string[];
}
export interface WorldFactProposal {
  id: string;
  subject: string;
  text: string;
  rigidity: 'hard' | 'soft';
  storyTime: number | null;
  knownBy: { characterId: string; learnedAt: number | null }[];
}
export interface FuturePlan {
  id: string;
  subject: string;
  intent: string;
}
export interface CoreContent {
  characters: CharacterDesign[];
  worldFacts: WorldFactProposal[];
  plans: FuturePlan[];
}
export interface CoreStartRequest {
  requestId: string;
  expectedInputVersion: number;
  expectedDirectionVersion: number;
  expectedStyleVersion: number;
  request: string;
}
export interface CoreJob {
  id: string;
  version: number;
  status: PlanningJob['status'];
  request: CoreStartRequest;
  input: {
    source: PlanningInput;
    selection: DirectionSelection;
    style: StyleSelection;
    request: string;
  };
  output: CoreContent | null;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  calls: PlanningJob['calls'];
  message: string;
  createdAt: string;
}
export interface CoreSelection {
  version: number;
  inputVersion: number;
  directionVersion: number;
  styleVersion: number;
  sourceCoreVersion: number;
  jobId: string;
  candidateVersion: number;
  content: CoreContent;
  decisions: Record<string, CoreDecision>;
  createdAt: string;
}
export interface CoreSaveRequest {
  expectedInputVersion: number;
  expectedDirectionVersion: number;
  expectedStyleVersion: number;
  expectedCoreVersion: number;
  sourceCoreVersion: number;
  jobId: string;
  candidateVersion: number;
  content: CoreContent;
  decisions: Record<string, CoreDecision>;
}
