import type { PlanningInput, DirectionSelection, PlanningJob } from './planning';
export interface TemporaryBeat {
  summary: string;
  facts: string[];
  outcome: string;
  pov: string;
  tense: string;
}
export interface TrialVariant {
  id: string;
  label: string;
  instructions: string;
  anchorText: string;
  bannedPhrases: string[];
}
export interface TrialSetup {
  beat: TemporaryBeat;
  variants: TrialVariant[];
}
export interface StyleTrialRequest extends TrialSetup {
  requestId: string;
  expectedInputVersion: number;
  expectedDirectionVersion: number;
}
export interface StyleTrialJob {
  id: string;
  version: number;
  request: StyleTrialRequest;
  createdAt: string;
  promptVersion: string;
  schemaVersion: string;
  report: {
    status: PlanningJob['status'];
    model: string;
    message: string;
    inputDigest: string;
    input: TrialSetup & { source: PlanningInput; selection: DirectionSelection };
    samples: {
      variant: TrialVariant;
      text: string;
      stats: {
        mean: number;
        variance: number;
        calibrated: boolean;
        sentenceLengths: number[];
        hits: { phrase: string; count: number }[];
      };
    }[];
    calls: PlanningJob['calls'];
    usage: { inputTokens: number; outputTokens: number; known: boolean };
  };
}
export interface StyleRules {
  pov: string;
  tense: string;
  tone: string;
  sentenceLength: { min: number; max: number };
  dialogueRatio: { min: number; max: number };
  bannedPhrases: string[];
  styleArc: string;
}
export interface StyleSelectionRequest {
  sourceStyleVersion?: number;
  expectedInputVersion: number;
  expectedDirectionVersion: number;
  expectedStyleVersion: number;
  jobId: string;
  candidateVersion: number;
  variantId: string;
  anchorText: string;
  rules: StyleRules;
}
export interface StyleSelection {
  sourceStyleVersion?: number;
  version: number;
  inputVersion: number;
  directionVersion: number;
  anchorVersion: number;
  jobId: string;
  candidateVersion: number;
  variantId: string;
  anchorText: string;
  rules: StyleRules;
  createdAt: string;
}
