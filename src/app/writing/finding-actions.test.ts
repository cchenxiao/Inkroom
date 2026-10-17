import { expect, it } from 'vitest';
import { findingRewrite, replaceFindingQuote } from './finding-actions';
import type { BackendRun } from '@/features/prepare/types/backend';
const run = {
  result: {
    segments: [
      { id: 's1', text: '前文。😀旧句。后文。' },
      { id: 's2', text: '邻稿保持。' },
    ],
    report: {
      findings: [{ id: 'f1', segmentId: 's1', quote: '😀旧句。', reason: '数量前后不一致' }],
    },
  },
} as unknown as BackendRun;
it('replaces only the cited text, preserving the surrounding manuscript', () => {
  expect(replaceFindingQuote(run, 'f1', '新句。')).toEqual({
    segmentId: 's1',
    text: '前文。新句。后文。',
  });
  expect(replaceFindingQuote(run, 'f1', '').text).toBe('前文。后文。');
  expect(run.result?.segments[1].text).toBe('邻稿保持。');
  expect(() => replaceFindingQuote(run, 'gone', 'x')).toThrow();
});
it('sends the actual finding, author requirement and explicit scope to the writer', () => {
  const request = findingRewrite(run, 'f1', '数量按两页修正', false);
  expect(request).toMatchObject({
    segmentId: 's1',
    original: '前文。😀旧句。后文。',
    start: 3,
    end: 7,
  });
  expect(request.instruction).toContain('数量前后不一致');
  expect(request.instruction).toContain('数量按两页修正');
  expect(request.instruction).toContain('其他情节段仅作衔接参照，不可修改');
  expect(findingRewrite(run, 'f1', '按此修改', true)).toMatchObject({ start: 0, end: 10 });
});
it('refuses ambiguous quotes and oversize requests without silently changing scope', () => {
  const repeated = structuredClone(run);
  repeated.result!.segments[0].text += '😀旧句。';
  expect(() => replaceFindingQuote(repeated, 'f1', '新句')).toThrow(/多次/);
  expect(() => findingRewrite(repeated, 'f1', '改这句', false)).toThrow(/多次/);
  expect(() => findingRewrite(run, 'f1', '字'.repeat(1000), true)).toThrow(/1000/);
});
