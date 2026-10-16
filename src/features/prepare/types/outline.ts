import type { PlanningInput, DirectionSelection, PlanningJob, PlanningState } from './planning';
import type { CoreSelection } from './core-settings';
import type { StyleSelection } from './style-trial';
export interface PlanningVersions {
  input: number;
  direction: number;
  style: number;
  core: number;
}
export interface OutlineAct {
  id: string;
  title: string;
  purpose: string;
}
export interface OutlineChapter {
  id: string;
  actId: string;
  title: string;
  purpose: string;
  event: string;
  arc: string;
  reveal: string;
  withhold: string;
  characterIds: string[];
  targetWords: number;
  storyTime: number | null;
}
export interface OutlineContent {
  acts: OutlineAct[];
  chapters: OutlineChapter[];
  bindings: {
    style: { chapterId: string; guidance: string }[];
    plans: { planId: string; chapterIds: string[]; purpose: string }[];
  };
}
export interface OutlineStartRequest {
  requestId: string;
  expected: PlanningVersions;
  request: string;
  chapterCount: number;
}
export interface OutlineJob {
  id: string;
  version: number;
  status: PlanningJob['status'];
  request: OutlineStartRequest;
  input: {
    versions: PlanningVersions;
    source: PlanningInput;
    direction: DirectionSelection;
    style: StyleSelection;
    core: CoreSelection;
    request: string;
    chapterCount: number;
  };
  output: OutlineContent | null;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  calls: PlanningJob['calls'];
  message: string;
  createdAt: string;
}
export interface OutlineSaveRequest {
  expected: PlanningVersions;
  expectedOutlineVersion: number;
  sourceOutlineVersion: number;
  jobId: string;
  candidateVersion: number;
  content: OutlineContent;
  confirmed: boolean;
}
export interface OutlineSelection {
  version: number;
  bindingsVersion: number;
  versions: PlanningVersions;
  sourceOutlineVersion: number;
  jobId: string;
  candidateVersion: number;
  content: OutlineContent;
  confirmed: boolean;
  createdAt: string;
}
export const planningVersions = (s: PlanningState): PlanningVersions => ({
  input: s.input.version,
  direction: s.directionVersion,
  style: s.styleVersion,
  core: s.coreVersion ?? 0,
});
export const sameVersions = (a: PlanningVersions, b: PlanningVersions) =>
  a.input === b.input && a.direction === b.direction && a.style === b.style && a.core === b.core;
export function outlineReady(s: PlanningState) {
  const c = s.coreSelection;
  return Boolean(
    c &&
    c.version === s.coreVersion &&
    c.inputVersion === s.input.version &&
    c.directionVersion === s.directionVersion &&
    c.styleVersion === s.styleVersion &&
    s.selection?.inputVersion === s.input.version &&
    s.styleSelection?.inputVersion === s.input.version &&
    s.styleSelection?.directionVersion === s.directionVersion &&
    s.styleSelection?.version === s.styleVersion &&
    c.content.characters.some((ch) => c.decisions[ch.id] === 'confirmed'),
  );
}
