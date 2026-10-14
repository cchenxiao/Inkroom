import type { ConflictChoice } from '@/types/domain';
import { pages } from '@/shared/lib/messages-pages';
export interface ConflictDecision {
  choice: ConflictChoice;
  isDialogueLie: boolean;
  reason: string;
  draftVersion: number;
  branchId: string;
}
export async function resolveConflict<T>(
  send: (value: ConflictDecision) => Promise<T>,
  decision: ConflictDecision,
  stale: boolean,
): Promise<T> {
  if (stale) throw new Error(pages.common.stale);
  if (!decision.reason.trim()) throw new Error(pages.common.required);
  return send(decision);
}
