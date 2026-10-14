import { useState } from 'react';
import { useAction } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import { Button, Badge, Card } from '@/shared/ui';
import type { ChapterDocument, RevisionPatch } from '@/types/domain';
export default function ReviewPatch({ patch, version }: { patch: RevisionPatch; version: number }) {
  const branchId = useUIStore((s) => s.branchId);
  const stale = useUIStore((s) => s.stale);
  const [selected, setSelected] = useState(
    patch.sentences.filter((s) => s.status !== 'rejected').map((s) => s.id),
  );
  const apply = useAction<ChapterDocument, unknown>(`/patches/${patch.id}/apply`);
  const discard = useAction(`/patches/${patch.id}/discard`);
  const disabled = stale || patch.draftVersion !== version || patch.status !== 'pending';
  return (
    <Card>
      <div className="page-row">
        <Badge tone="ai">{patch.origin === 'agent' ? 'Agent' : t.common.author}</Badge>
        <small>v{patch.draftVersion}</small>
      </div>
      {patch.sentences.map((sentence) => (
        <div key={sentence.id} className="sentence-diff">
          <label>
            <input
              type="checkbox"
              checked={selected.includes(sentence.id)}
              disabled={disabled}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, sentence.id]
                    : selected.filter((id) => id !== sentence.id),
                )
              }
            />
            <span>{t.review.accept}</span>
          </label>
          <div className="diff-old">− {sentence.oldText}</div>
          <div className="diff-new">+ {sentence.newText}</div>
        </div>
      ))}
      <div className="page-actions">
        <Button
          size="sm"
          variant="human"
          disabled={disabled || !selected.length || apply.isPending}
          disabledReason={stale || patch.draftVersion !== version ? t.common.stale : t.common.done}
          onClick={() =>
            void apply
              .mutateAsync({
                draftVersion: version,
                acceptedSentenceIds: selected,
                branchId,
              })
              .catch(() => undefined)
          }
        >
          {patch.status === 'applied' ? t.review.accepted : t.review.accept}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || discard.isPending}
          onClick={() =>
            void discard.mutateAsync({ draftVersion: version, branchId }).catch(() => undefined)
          }
        >
          {t.review.discard}
        </Button>
      </div>
      {(apply.error || discard.error) && (
        <p role="alert" className="page-error">
          {(apply.error ?? discard.error)?.message}
        </p>
      )}
    </Card>
  );
}
