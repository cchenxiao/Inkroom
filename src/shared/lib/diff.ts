import DiffMatchPatch from 'diff-match-patch';
export type TextDiff = { kind: 'equal' | 'insert' | 'delete'; text: string };
/** Semantic cleanup keeps a sentence's unchanged context readable in inline reviews. */
export function sentenceDiff(before: string, after: string): TextDiff[] {
  const engine = new DiffMatchPatch();
  const diffs = engine.diff_main(before, after);
  engine.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => ({
    kind: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
    text,
  }));
}
