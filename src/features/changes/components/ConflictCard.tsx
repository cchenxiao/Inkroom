import { editorialPages as e } from '@/shared/lib/messages-editorial-pages';
import { useState } from 'react';
import { Waypoints } from 'lucide-react';
import { useAction } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import { Button, Card, Field, Textarea } from '@/shared/ui';
import type { Conflict, ConflictChoice } from '@/types/domain';
import { resolveConflict, type ConflictDecision } from '../conflict';
export default function ConflictCard({
  conflict,
  version,
  branchId,
}: {
  conflict: Conflict;
  version: number;
  branchId: string;
}) {
  const stale = useUIStore((s) => s.stale);
  const [choice, setChoice] = useState<ConflictChoice | null>(null);
  const [reason, setReason] = useState('');
  const [lie, setLie] = useState(conflict.isDialogueLie);
  const action = useAction<Conflict, ConflictDecision>(`/conflicts/${conflict.id}/resolve`);
  return (
    <Card className="conflict-card">
      <div className="page-row">
        <h3>{conflict.title}</h3>
        <small title={conflict.field}>{conflict.field.split('.').at(-1)}</small>
      </div>
      <div className="evidence-pair conflict-comparison">
        <div>
          <small>{t.changes.bible}</small>
          <p>{conflict.bibleSays}</p>
        </div>
        <div>
          <small>{t.changes.manuscript}</small>
          <p>{conflict.manuscriptSays}</p>
        </div>
        <div>
          <small>{t.changes.evidence}</small>
          <p>{conflict.witnessRefs.join(' · ') || e.changes.noEvidence}</p>
        </div>
      </div>
      <div className="conflict-choices" role="group" aria-label={t.changes.choice}>
        {conflict.options.map((option) => (
          <Button
            key={option}
            variant={choice === option ? 'human' : 'secondary'}
            aria-pressed={choice === option}
            onClick={() => setChoice(option)}
          >
            {t.changes.choices[option]}
          </Button>
        ))}
      </div>
      <label className="check-label">
        <input type="checkbox" checked={lie} onChange={(e) => setLie(e.target.checked)} />
        {t.changes.dialogueLie}
      </label>
      <Field label={t.changes.resolutionReason}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </Field>
      <div className="page-actions">
        <Button
          variant="human"
          disabled={!choice || !reason.trim() || stale || action.isPending || !version}
          disabledReason={stale ? t.common.stale : t.common.required}
          onClick={() => {
            if (choice)
              void resolveConflict(
                action.mutateAsync,
                { choice, reason, isDialogueLie: lie, draftVersion: version, branchId },
                stale,
              ).catch(() => undefined);
          }}
        >
          <Waypoints size={14} />
          {t.changes.resolve}
        </Button>
      </div>
      {action.error && (
        <p role="alert" className="page-error">
          {action.error.message}
        </p>
      )}
    </Card>
  );
}
