import type { FactCandidate, FactDecision } from './chapter-facts';

export const factDecisionReasons: Record<FactDecision['action'], string> = {
  confirm: '作者选择确认为新增事实',
  exclude: '作者选择不写入章末事实',
  keep_existing: '作者选择保留已有事实',
  revise_manuscript: '作者要求先修改正文',
};

/** Preserve explicit author decisions, including corrections and unresolved conflicts. */
export function completeFactDecisions(
  candidates: FactCandidate[],
  decisions: FactDecision[],
  mode: 'events' | 'exclude',
): FactDecision[] {
  const decided = new Set(decisions.map((d) => d.candidateId));
  return [
    ...decisions,
    ...candidates
      .filter((c) => !decided.has(c.id))
      .map((c): FactDecision => {
        const action =
          mode === 'events' && c.kind === 'event' && !c.relatedFactId ? 'confirm' : 'exclude';
        return {
          candidateId: c.id,
          action,
          text: c.text,
          knownBy: action === 'confirm' ? (c.suggestedKnowers ?? []).map((k) => k.characterId) : [],
          reason: factDecisionReasons[action],
        };
      }),
  ];
}
