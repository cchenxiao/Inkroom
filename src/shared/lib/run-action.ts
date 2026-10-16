import type { ChapterDocument } from '@/types/domain';
import { finalizeBlockers } from './rules';
import { studio } from './messages-studio';
import { shellText } from './messages-shell';
export interface PrimaryRunAction {
  kind: 'pause' | 'review' | 'start' | 'resume' | 'finalize';
  label: string;
  variant: 'default' | 'human' | 'secondary';
  disabled: boolean;
  reason: string;
}
export function deriveRunAction(
  data: ChapterDocument | undefined,
  stale: boolean,
): PrimaryRunAction {
  const base: PrimaryRunAction = {
    kind: 'start',
    label: studio.continue,
    variant: 'default',
    disabled: !data || stale,
    reason: stale ? shellText.stale : '',
  };
  if (!data) return { ...base, reason: '正在载入稿本' };
  if (data.chapter.status === 'finalized')
    return {
      ...base,
      kind: 'finalize',
      label: studio.finalized,
      variant: 'secondary',
      disabled: true,
      reason: studio.finalized,
    };
  if (data.run.status === 'running')
    return { ...base, kind: 'pause', label: studio.pause, variant: 'secondary' };
  // Human decisions take precedence, including when the score gate passes.
  if (['waiting_human', 'escalated'].includes(data.run.status))
    return {
      ...base,
      kind: 'review',
      label: studio.adjudicate,
      variant: 'human',
      disabled: false,
      reason: '',
    };
  if (data.run.status === 'paused') return { ...base, kind: 'resume', label: studio.continue };
  const blockers = [
    ...finalizeBlockers(data.scores, stale),
    ...(data.run.draftVersion !== data.chapter.draftVersion ? [shellText.reviewOutdated] : []),
  ];
  if (data.scores.canFinalize && !blockers.length)
    return { ...base, kind: 'finalize', label: studio.finalize, variant: 'human' };
  return base;
}
