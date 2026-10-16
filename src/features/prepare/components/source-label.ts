import { textLabel } from '@/shared/lib/business-labels';
import type { BackendRun } from '../types/backend';

export function sourceLabel(run: BackendRun, id: string, fallback = '关联材料') {
  const context = run.result?.context;
  const character = context?.characters.find((c) => c.id === id);
  if (character) return character.name;
  const record = [
    ...(context?.facts ?? []),
    ...(context?.sources ?? []),
    ...(context?.characters.flatMap((c) => [...c.hardTraits, ...c.knows]) ?? []),
    ...(run.result?.segments ?? []),
    ...(run.criticLookups?.flatMap((c) => c.review.evidence?.hits.map((h) => h.record) ?? []) ??
      []),
  ].find((item) => item.id === id);
  return textLabel(record?.text, fallback);
}
