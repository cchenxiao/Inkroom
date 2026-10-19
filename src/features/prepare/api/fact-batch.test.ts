import { expect, it } from 'vitest';
import { completeFactDecisions } from './fact-batch';
import type { FactCandidate, FactDecision } from './chapter-facts';
const candidates = ['event', 'statement', 'uncertain', 'event'].map((kind, i) => ({
  id: String(i),
  kind,
  text: `候选${i}`,
  relatedFactId: i === 3 ? 'old' : '',
  evidence: { ref: 's', quote: '原文' },
  reason: '',
  suggestedKnowers: [{ characterId: 'shen', evidence: { ref: 's', quote: '原文' } }],
})) as FactCandidate[];
it('completes a mixed batch without treating claims or old-fact conflicts as new events', () => {
  const result = completeFactDecisions(candidates, [], 'events');
  expect(result.map((d) => d.action)).toEqual(['confirm', 'exclude', 'exclude', 'exclude']);
  expect(result[0].knownBy).toEqual(['shen']);
  expect(result.slice(1).every((d) => d.knownBy.length === 0)).toBe(true);
  expect(new Set(result.map((d) => d.candidateId)).size).toBe(4);
});
it('excludes all remaining candidates while preserving previous text, knowers and conflict decisions', () => {
  const previous: FactDecision[] = [
    { candidateId: '0', action: 'confirm', text: '作者修正', knownBy: [], reason: '核对过' },
    {
      candidateId: '3',
      action: 'revise_manuscript',
      text: '旧事实冲突',
      knownBy: [],
      reason: '先改稿',
    },
  ];
  const result = completeFactDecisions(candidates, previous, 'exclude');
  expect(result.slice(0, 2)).toEqual(previous);
  expect(result.slice(2).map((d) => d.action)).toEqual(['exclude', 'exclude']);
  expect(completeFactDecisions(candidates, result, 'events')).toEqual(result);
});
