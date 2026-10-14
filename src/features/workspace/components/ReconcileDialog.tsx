import { Button, Modal } from '@/shared/ui';
import type { ChapterDocument } from '@/types/domain';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
export function ReconcileDialog({
  snapshot,
  drafts,
  currentVersion,
  onClose,
  onConfirm,
}: {
  snapshot: ChapterDocument | null;
  drafts: Record<string, string>;
  currentVersion: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const changed = !!snapshot && snapshot.chapter.draftVersion !== currentVersion;
  const missing =
    !!snapshot &&
    Object.keys(drafts).some((id) => !snapshot.segments.some((segment) => segment.id === id));
  return (
    <Modal
      open={!!snapshot}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={m.reconcileTitle}
      description={m.reconcileDescription}
      footer={
        <>
          <Button onClick={onClose}>{m.cancel}</Button>
          <Button variant="human" disabled={changed || missing} onClick={onConfirm}>
            {m.reconcileConfirm}
          </Button>
        </>
      }
    >
      <p className="quiet">
        {m.version} · v{snapshot?.chapter.draftVersion}
      </p>
      {changed && (
        <p role="alert" className="diff-stale">
          {m.reconcileChanged}
        </p>
      )}
      {Object.entries(drafts).map(([id, text]) => {
        const remote = snapshot?.segments.find((segment) => segment.id === id);
        return (
          <section className="reconcile-segment" key={id}>
            <h3>{id}</h3>
            <div className="reconcile-pair">
              <div>
                <h4>{m.reconcileRemote}</h4>
                <p>{remote?.text ?? m.reconcileMissing}</p>
              </div>
              <div>
                <h4>{m.reconcileLocal}</h4>
                <p>{text}</p>
              </div>
            </div>
          </section>
        );
      })}
    </Modal>
  );
}
