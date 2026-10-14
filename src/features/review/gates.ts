import type { QualityGateScores, RunActionInput } from '@/types/domain';
import { pages } from '@/shared/lib/messages-pages';
export interface ReviewGate {
  scores: QualityGateScores;
  stale: boolean;
  currentVersion: number;
  reviewVersion: number;
}
export function reviewBlockers(gate: ReviewGate): string[] {
  const result = [...gate.scores.blockers];
  if (gate.stale) result.push(pages.common.stale);
  if (gate.currentVersion !== gate.reviewVersion) result.push(pages.review.wrongVersion);
  if (gate.scores.p0Count > 0) result.push(pages.review.p0);
  if (!gate.scores.canFinalize) result.push(pages.review.quality);
  return [...new Set(result)];
}
export async function approveReview<T>(
  send: (value: RunActionInput) => Promise<T>,
  gate: ReviewGate,
): Promise<T> {
  const blockers = reviewBlockers(gate);
  if (blockers.length) throw new Error(blockers.join('；'));
  return send({ action: 'approve', draftVersion: gate.currentVersion });
}
