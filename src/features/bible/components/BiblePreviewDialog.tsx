import { Check } from 'lucide-react';
import { Button, Badge, Modal } from '@/shared/ui';
import { useAction } from '@/shared/api/hooks';
import { pages as t } from '@/shared/lib/messages-pages';
import type { ChangeSet } from '@/types/domain';
export default function BiblePreviewDialog({
  preview,
  onClose,
  branchId,
  stale,
}: {
  preview: ChangeSet | null;
  onClose: () => void;
  branchId: string;
  stale: boolean;
}) {
  const apply = useAction<ChangeSet, unknown>(`/changesets/${preview?.id ?? ''}/apply`);
  const applyPreview = async (strategy: 'mark_only' | 'propagate') => {
    if (!preview) return;
    await apply.mutateAsync({ strategy, draftVersion: preview.draftVersion, branchId });
    onClose();
  };
  return (
    <Modal
      open={!!preview}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.bible.previewTitle}
      description={t.bible.previewHelp}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={apply.isPending || stale}
            onClick={() => void applyPreview('mark_only').catch(() => undefined)}
          >
            {t.bible.mark}
          </Button>
          <Button
            variant="human"
            disabled={apply.isPending || stale}
            disabledReason={t.common.stale}
            onClick={() => void applyPreview('propagate').catch(() => undefined)}
          >
            {t.bible.propagate}
          </Button>
        </>
      }
    >
      {preview && (
        <div className="page-stack">
          <div className="page-diff">
            <div>
              <small>{t.common.before}</small>
              <pre>{JSON.stringify(preview.old, null, 2)}</pre>
            </div>
            <div>
              <small>{t.common.after}</small>
              <pre>{JSON.stringify(preview.new, null, 2)}</pre>
            </div>
          </div>
          {preview.blastRadius.length ? (
            preview.blastRadius.map((ref) => (
              <div className="impact-row" key={ref.id}>
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
              </div>
            ))
          ) : (
            <p>
              <Check size={14} />
              {t.bible.noImpact}
            </p>
          )}
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
