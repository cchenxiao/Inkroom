/** 作品层前端演示契约；尚非 Go 后端多作品接口。 */
import type { Bible, Chapter, Project, QualityGateScores } from './index';
export type BookStage = 'planning' | 'writing' | 'finalized';
export type PlanStep = 0 | 1 | 2 | 3;
export interface BookSummary {
  project: Project;
  status: BookStage;
  accent: 'ai' | 'human' | 'foreshadow';
  branchId: string;
  branchName: string;
  totalWords: number;
  finalizedChapters: number;
  totalChapters: number;
  updatedAt: string;
  wizardId: string | null;
  demo: true;
}
export interface BookOverview extends BookSummary {
  chapters: Chapter[];
  acts: { id: string; title: string; chapterIds: string[] }[];
  bible: Bible;
  beatProgress: { done: number; total: number };
  quality: QualityGateScores;
  worstFinding: { severity: string; reason: string; chapterId: string; segmentId: string } | null;
  heatmap: { chapterId: string; label: string; value: number | null }[];
  confirmed: { direction: boolean; style: boolean; world: boolean; outline: boolean };
}
export interface BookBrief {
  name: string;
  logline: string;
  genre: string;
  targetWords: number;
}
export interface DirectionDraft {
  kind: 'direction';
  tone: string;
  coreConflict: string;
  appeal: string;
  note: string;
}
export interface StyleDraft {
  kind: 'style';
  pov: string;
  tense: string;
  sentenceMin: number;
  sentenceMax: number;
  dialogueMin: number;
  dialogueMax: number;
  bannedWords: string[];
  styleArc: string;
}
export interface WorldDraft {
  kind: 'world';
  characters: {
    id: string;
    name: string;
    want: string;
    need: string;
    flaw: string;
    arc: string;
    hardTraits: string;
    confirmed: boolean;
  }[];
  rules: { id: string; text: string; confirmed: boolean }[];
}
export interface OutlineDraft {
  kind: 'outline';
  acts: { id: string; title: string }[];
  chapters: {
    id: string;
    actId: string;
    title: string;
    purpose: string;
    scenes: {
      id: string;
      title: string;
      beats: { id: string; title: string; description: string }[];
    }[];
  }[];
}
export type PlanContent = DirectionDraft | StyleDraft | WorldDraft | OutlineDraft;
export interface BookCandidate {
  id: string;
  title: string;
  summary: string;
  content: PlanContent;
}
export interface BookPlanStep {
  candidates: BookCandidate[];
  selectedId: string | null;
  locked: boolean;
  basedOn: string;
}
export interface BookPlan {
  projectId: string;
  version: number;
  brief: BookBrief;
  steps: [BookPlanStep, BookPlanStep, BookPlanStep, BookPlanStep];
}
export type PlanAction =
  | { action: 'brief'; brief: BookBrief }
  | { action: 'generate'; step: PlanStep }
  | { action: 'select'; step: PlanStep; candidateId: string }
  | { action: 'edit'; step: PlanStep; candidateId: string; content: PlanContent }
  | { action: 'lock' | 'unlock'; step: PlanStep };
