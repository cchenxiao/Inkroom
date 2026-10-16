import type { OutlineJob, OutlineSelection } from './outline';
import type { CoreJob, CoreSelection } from './core-settings';
import type { StyleTrialJob, StyleSelection } from './style-trial';
export interface PlanningIntake {
  premise: string;
  genres: string;
  targetWords: string;
  narrative: string;
  preferences: string;
  references: { title: string; dimension: string }[];
  packs: { id: string; version: number; overrides?: Record<string, string> }[];
}
export interface ToneDirection {
  title: string;
  logline: string;
  coreConflict: string;
  characterDilemma: string;
  readerAppeal: string;
  tone: string;
  narrative: string;
  tradeoff: string;
}
export interface PlanningPack {
  id: string;
  version: number;
  name: string;
  guidance: string;
}
export interface PlanningInput {
  version: number;
  digest: string;
  intake: PlanningIntake;
  effectivePacks: PlanningPack[];
}
export interface PlanningJob {
  id: string;
  version: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  input: PlanningInput;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  directions: ToneDirection[];
  message: string;
  createdAt: string;
  calls: {
    number: number;
    phase: string;
    promptVersion: string;
    elapsedMs: number;
    success: boolean;
    usage: { inputTokens: number; outputTokens: number; known: boolean };
  }[];
}
export interface DirectionSelection {
  version: number;
  inputVersion: number;
  inputDigest: string;
  jobId: string;
  candidateVersion: number;
  candidateIndex: number;
  direction: ToneDirection;
  createdAt: string;
}
export interface PlanningState {
  outlineVersion?: number;
  outlineSelection?: OutlineSelection | null;
  outlineJobs?: OutlineJob[];
  coreVersion?: number;
  coreSelection?: CoreSelection | null;
  coreJobs?: CoreJob[];
  styleVersion: number;
  styleJobs: StyleTrialJob[];
  styleSelection: StyleSelection | null;
  input: PlanningInput;
  directionVersion: number;
  selection: DirectionSelection | null;
  jobs: PlanningJob[];
  packs: PlanningPack[];
}
export interface DirectionRequest {
  expectedInputVersion: number;
  expectedDirectionVersion: number;
  jobId: string;
  candidateVersion: number;
  candidateIndex: number;
  direction: ToneDirection;
}
