import type { RunNode } from '@/types/domain';
/** Presentation capabilities, independent from the Mock orchestration state machine. */
export const plannedNodes: ReadonlySet<RunNode> = new Set([
  'style',
  'reader',
  'structural_reviser',
  'bible_update',
]);
