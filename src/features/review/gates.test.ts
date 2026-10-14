import { describe, expect, it, vi } from 'vitest';
import { approveReview, reviewBlockers } from './gates';
import type { QualityGateScores } from '@/types/domain';
const scores: QualityGateScores = { items: [], p0Count: 0, canFinalize: true, blockers: [] };
describe('human approval version gate', () => {
  it('refuses stale approval without writing to the API', async () => {
    const send = vi.fn();
    await expect(
      approveReview(send, { scores, stale: true, currentVersion: 4, reviewVersion: 3 }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('blocks unresolved P0 findings', () =>
    expect(
      reviewBlockers({
        scores: { ...scores, p0Count: 1 },
        stale: false,
        currentVersion: 3,
        reviewVersion: 3,
      }).length,
    ).toBeGreaterThan(0));
  it('sends current version after every gate passes', async () => {
    const send = vi.fn().mockResolvedValue({});
    await approveReview(send, { scores, stale: false, currentVersion: 3, reviewVersion: 3 });
    expect(send).toHaveBeenCalledWith({ action: 'approve', draftVersion: 3 });
  });
});
