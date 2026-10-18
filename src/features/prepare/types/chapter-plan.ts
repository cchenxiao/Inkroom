import type { OutlineJob, OutlineSelection, PlanningVersions } from './outline';
import { outlineReady, planningVersions, sameVersions } from './outline';
import type { PlanningState } from './planning';
export interface ChapterPlanVersions {
  planning: PlanningVersions;
  outline: number;
  bindings: number;
}
export interface PlannedBeat {
  id: string;
  title: string;
  action: string;
  turn: string;
}
export interface PlannedScene {
  id: string;
  title: string;
  goal: string;
  conflict: string;
  outcome: string;
  povCharacterId: string;
  characterIds: string[];
  storyTime: number | null;
  beats: PlannedBeat[];
}
export interface ChapterBrief {
  selectedBeatId: string;
  mustHappen: string;
  cannotChange: string;
  reveal: string;
  withhold: string;
  writingGuidance: string;
}
export interface ChapterPlanContent {
  targetWords?: number;
  scenes: PlannedScene[];
  brief: ChapterBrief;
}
export interface ChapterPlanInput {
  previousChapter?: {
    publicationId: string;
    chapterId: string;
    version: number;
    ending: string;
    facts: { id: string; text: string; storyTime: number; knownBy: string[] }[];
  };
  base: OutlineJob['input'];
  outline: OutlineSelection;
  chapterId: string;
  request: string;
}
export interface ChapterPlanStartRequest {
  requestId: string;
  expected: ChapterPlanVersions;
  chapterId: string;
  request: string;
}
export interface ChapterPlanJob {
  id: string;
  version: number;
  status: OutlineJob['status'];
  request: ChapterPlanStartRequest;
  input: ChapterPlanInput;
  output: ChapterPlanContent | null;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  calls: OutlineJob['calls'];
  message: string;
  createdAt: string;
}
export interface ChapterPlanSaveRequest {
  expected: ChapterPlanVersions;
  chapterId: string;
  expectedVersion: number;
  sourceVersion: number;
  jobId: string;
  candidateVersion: number;
  content: ChapterPlanContent;
  confirmed: boolean;
}
export interface ChapterPlanSelection {
  version: number;
  versions: ChapterPlanVersions;
  chapterId: string;
  sourceVersion: number;
  jobId: string;
  candidateVersion: number;
  input: ChapterPlanInput;
  content: ChapterPlanContent;
  knowledge: { sceneId: string; knownFactIds: string[]; excludedFactIds: string[] }[];
  confirmed: boolean;
  createdAt: string;
}
export const chapterPlanVersions = (s: PlanningState): ChapterPlanVersions => ({
  planning: planningVersions(s),
  outline: s.outlineVersion ?? 0,
  bindings: s.outlineSelection?.bindingsVersion ?? 0,
});
export const sameChapterPlanVersions = (a: ChapterPlanVersions, b: ChapterPlanVersions) =>
  sameVersions(a.planning, b.planning) && a.outline === b.outline && a.bindings === b.bindings;
export const chapterPlanReady = (s: PlanningState) =>
  Boolean(
    outlineReady(s) &&
    s.outlineSelection?.confirmed &&
    s.outlineSelection.version === s.outlineVersion &&
    sameVersions(s.outlineSelection.versions, planningVersions(s)),
  );
