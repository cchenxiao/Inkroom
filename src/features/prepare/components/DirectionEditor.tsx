import { Button, Field, Textarea } from '@/shared/ui';
import { planningMessages as t } from '@/shared/lib/messages-planning';
import type { ToneDirection } from '../types/planning';
export const emptyDirection: ToneDirection = {
  title: '',
  logline: '',
  coreConflict: '',
  characterDilemma: '',
  readerAppeal: '',
  tone: '',
  narrative: '',
  tradeoff: '',
};
export default function DirectionEditor({
  value,
  stale,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  value: ToneDirection;
  stale: boolean;
  pending: boolean;
  onChange: (d: ToneDirection) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const valid = Object.values(value).every((text) => text.trim() && text.length <= 800);
  return (
    <div className="planning-direction-editor">
      {stale && (
        <p role="alert" className="page-error">
          {t.staleEditor}
        </p>
      )}
      <fieldset disabled={pending || stale} className="planning-direction-fields">
        {(Object.keys(t.fields) as (keyof ToneDirection)[]).map((key) => (
          <Field key={key} label={t.fields[key]}>
            <Textarea
              rows={key === 'title' ? 1 : 2}
              maxLength={800}
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </Field>
        ))}
      </fieldset>
      <div className="planning-editor-actions">
        <Button
          variant="human"
          disabled={stale || !valid}
          loading={pending}
          disabledReason={stale ? t.staleEditor : t.required}
          onClick={onSave}
        >
          {t.adopt}
        </Button>
        <Button disabled={pending} onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </div>
  );
}
