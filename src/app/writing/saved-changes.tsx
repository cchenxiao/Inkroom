import type { BackendRun } from '@/features/prepare/types/backend';
import { Button } from '@/shared/ui';
import { TextChange } from './text-change';

export type SavedChange = {
  id: string;
  segmentId: string;
  before: string;
  after: string;
  quote: string;
  label: string;
  current: boolean;
};
/** Read persisted patches, with a truthful old-request fallback for legacy runs. */
export function savedChanges(run?: BackendRun): SavedChange[] {
  if (!run?.result || run.status === 'running' || run.result.findingProposal) return [];
  const result = run.result;
  const revisions = (result.revisions ?? []).filter(
    (r) => r.kind === 'local_edit' || r.kind.startsWith('author_'),
  );
  if (revisions.length)
    return revisions
      .flatMap((r, i) =>
        r.patches.map((p, j) => ({
          id: `${run.id}/${r.toVersion}/${i}/${j}`,
          segmentId: p.segmentId,
          before: p.oldText,
          after: p.newText,
          quote: p.newText,
          label: `修改对照 · v${r.fromVersion} → v${r.toVersion}`,
          current: r.toVersion === run.draftVersion,
        })),
      )
      .reverse();
  if (result.findingChanges?.length)
    return [...result.findingChanges].reverse().map((c) => ({
      id: `${run.id}/${c.toVersion}/${c.findingId}`,
      segmentId: c.segmentId,
      before: c.before,
      after: c.after,
      quote: c.after,
      label: `修改对照 · v${c.fromVersion} → v${c.toVersion}`,
      current: c.toVersion === run.draftVersion,
    }));
  const req = result.authorRequest ?? result.context?.revisionRequest ?? result.context?.rewrite;
  const current = result.segments?.find((s) => s.id === req?.segmentId);
  if (!req || typeof req.original !== 'string' || !current || current.text === req.original)
    return [];
  const chars = Array.from(req.original),
    prefix = chars.slice(0, req.start).join(''),
    suffix = chars.slice(req.end).join('');
  const bounded =
    current.text.startsWith(prefix) &&
    current.text.endsWith(suffix) &&
    current.text.length >= prefix.length + suffix.length;
  const after = bounded
    ? current.text.slice(prefix.length, suffix ? -suffix.length : undefined)
    : current.text;
  return [
    {
      id: `${run.id}/legacy/${run.draftVersion}`,
      segmentId: req.segmentId,
      before: bounded ? chars.slice(req.start, req.end).join('') : req.original,
      after,
      quote: after || suffix.slice(0, 60),
      label: '本次修改对照',
      current: true,
    },
  ];
}

export function SavedChangeCard({
  change,
  onClose,
}: {
  change: SavedChange;
  onClose?: () => void;
}) {
  return (
    <section className="finding-popover saved-change-card" aria-label="已保存修改对照">
      <header>
        <strong>{change.label}</strong>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            收起对照
          </Button>
        )}
      </header>
      <p className="muted">已保存到候选稿；是否解决问题以复检和你的判断为准。</p>
      <TextChange before={change.before} after={change.after} />
    </section>
  );
}
