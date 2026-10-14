import { ArrowUpRight } from 'lucide-react';
import { Button, Badge, Modal } from '@/shared/ui';
import { useAction } from '@/shared/api/hooks';
import { pages as t } from '@/shared/lib/messages-pages';
import type { ChangeSet } from '@/types/domain';
export default function ChangePreviewDialog({
  preview,
  onClose,
  branchId,
  stale,
  onLocate,
}: {
  preview: ChangeSet | null;
  onClose: () => void;
  branchId: string;
  stale: boolean;
  onLocate: (chapterId: string, segmentId: string) => void;
}) {
  const apply = useAction<ChangeSet, unknown>(`/changesets/${preview?.id ?? ''}/apply`);
  return (
    <Modal
      open={!!preview}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.changes.previewTitle}
      footer={
        <>
          <Button
            disabled={preview?.status !== 'preview' || apply.isPending || stale}
            onClick={() =>
              void apply
                .mutateAsync({
                  strategy: 'mark_only',
                  draftVersion: preview?.draftVersion,
                  chapterId: preview?.chapterId,
                  branchId,
                })
                .then(() => onClose())
                .catch(() => undefined)
            }
          >
            {t.changes.mark}
          </Button>
          <Button
            variant="human"
            disabled={preview?.status !== 'preview' || apply.isPending || stale}
            onClick={() =>
              void apply
                .mutateAsync({
                  strategy: 'propagate',
                  draftVersion: preview?.draftVersion,
                  chapterId: preview?.chapterId,
                  branchId,
                })
                .then(() => onClose())
                .catch(() => undefined)
            }
          >
            {t.changes.propagate}
          </Button>
        </>
      }
    >
      {preview && (
        <div className="page-stack">
          <div className="page-diff">
            <div>
              <small>{t.common.before}</small>
              <pre>
                {typeof preview.old === 'string'
                  ? preview.old
                  : JSON.stringify(preview.old, null, 2)}
              </pre>
            </div>
            <div>
              <small>{t.common.after}</small>
              <pre>
                {typeof preview.new === 'string'
                  ? preview.new
                  : JSON.stringify(preview.new, null, 2)}
              </pre>
            </div>
          </div>
          {preview.blastRadius.map((ref) => (
            <button
              className="impact-row"
              key={ref.id}
              onClick={() => onLocate(ref.chapterId, ref.segmentId)}
            >
              <Badge
                tone={
                  ref.level === 'rewrite'
                    ? 'danger'
                    : ref.level === 'orphan_foreshadow'
                      ? 'foreshadow'
                      : 'warning'
                }
              >
                {t.changes[ref.level]}
              </Badge>
              <div>
                <strong>{ref.label}</strong>
                <p>{ref.reason}</p>
              </div>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!preview.blastRadius.length && <p>{t.bible.noImpact}</p>}
          {preview.conflicts.map((c) => (
            <p className="page-warning" key={c.id}>
              {c.title}
            </p>
          ))}
          {apply.error && (
            <p role="alert" className="page-error">
              {apply.error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
