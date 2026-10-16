import type { StyleRules } from './style-trial';
import type { PlanningJob } from './planning';
export interface StyleAnalysisJob {
  id: string;
  version: number;
  status: PlanningJob['status'];
  input: {
    title: string;
    text: string;
    digest: string;
    totalCharacters: number;
    analyzedCharacters: number;
    samples: { start: number; end: number; text: string }[];
    stats: { mean: number; variance: number; calibrated: false; sentenceLengths: number[] };
  };
  output: {
    observations: {
      dimension: 'sentence' | 'rhythm' | 'dialogue' | 'distance' | 'imagery' | 'humor';
      sampleIndex: number;
      quote: string;
      reason: string;
      suggestion: string;
      certainty: 'observed' | 'tentative';
    }[];
    rules: StyleRules;
    anchorText: string;
    limitations: string;
  } | null;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  calls: PlanningJob['calls'];
  message: string;
  createdAt: string;
}
