import type { Finding, QualityGateScores, RunNode } from '@/types/domain';
export function routeFinding(finding: Pick<Finding, 'severity'>): RunNode {
  return (
    {
      P0: 'structural_reviser',
      P1: 'scene_reviser',
      P2: 'micro_polisher',
      P3: 'human_gate',
    } as const
  )[finding.severity];
}
export function finalizeBlockers(scores: QualityGateScores, stale: boolean): string[] {
  return [
    ...(stale ? ['稿本已变更，旧审批失效'] : []),
    ...(scores.p0Count > 0 ? [`仍有 ${scores.p0Count} 处 P0 硬伤`] : []),
    ...scores.items.filter((s) => s.calibrated && !s.passed).map((s) => `${s.label}未达标`),
    ...scores.blockers.filter((b) => !b.includes('P0')),
  ].filter((s, i, a) => a.indexOf(s) === i);
}
