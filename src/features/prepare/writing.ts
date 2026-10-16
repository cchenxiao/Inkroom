/** Public composition API: the app mounts real workflows in the original workspace. */
export { usePlanning } from './hooks/usePlanning';
export { usePlannedWriting } from './hooks/usePlannedWriting';
export { useWritingActions } from './hooks/useWritingActions';
export {
  chapterPlanReady,
  chapterPlanVersions,
  sameChapterPlanVersions,
} from './types/chapter-plan';
export { assemblyApi } from './api/chapter-assembly';
export { default as ChapterAssembly } from './components/ChapterAssembly';
export { default as RunFlow } from './components/BackendRunFlow';
export { default as ContextManifest } from './components/BackendContextManifest';
export type { BackendRun } from './types/backend';
export type { PlanningState } from './types/planning';
export type { ChapterPlanSelection } from './types/chapter-plan';
export type { AssemblyPreview } from './api/chapter-assembly';

export { sourceLabel } from './components/source-label';

export { useChapterCandidates } from './hooks/useChapterCandidates';
