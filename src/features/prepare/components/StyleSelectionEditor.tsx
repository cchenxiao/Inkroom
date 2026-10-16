import { Badge, Button, Field, Input, Textarea } from '@/shared/ui';
import { styleTrialMessages as t } from '@/shared/lib/messages-style-trial';
import type { StyleSelectionRequest } from '../types/style-trial';
export function validStyleSelection(value: StyleSelectionRequest) {
  const r = value.rules;
  const range = (v: { min: number; max: number }, max: number) =>
    Number.isFinite(v.min) &&
    Number.isFinite(v.max) &&
    v.min >= 0 &&
    v.min <= v.max &&
    v.max <= max;
  return Boolean(
    value.anchorText.trim() &&
    r.pov.trim() &&
    r.tense.trim() &&
    r.tone.trim() &&
    range(r.sentenceLength, 300) &&
    r.sentenceLength.max > 0 &&
    range(r.dialogueRatio, 1),
  );
}
export default function StyleSelectionEditor({
  value,
  stale,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  value: StyleSelectionRequest;
  stale: boolean;
  pending: boolean;
  onChange: (value: StyleSelectionRequest) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const rules = value.rules;
  const change = (patch: Partial<typeof rules>) =>
    onChange({ ...value, rules: { ...rules, ...patch } });
  return (
    <section className="style-selection-editor" aria-label={t.profile}>
      <div className="planning-heading">
        <h3>{t.profile}</h3>
        {!value.jobId && <Badge>{t.authorProvided}</Badge>}
        <Badge tone="human">方向 v{value.expectedDirectionVersion}</Badge>
      </div>
      {stale && (
        <p role="alert" className="page-error">
          {t.staleEdit}
        </p>
      )}
      <fieldset className="planning-intake" disabled={pending}>
        <Field label={t.anchor} hint={t.anchorHint}>
          <Textarea
            aria-label={t.anchor}
            className="style-anchor-input"
            rows={8}
            maxLength={4000}
            value={value.anchorText}
            onChange={(e) => onChange({ ...value, anchorText: e.target.value })}
          />
        </Field>
        <div className="planning-options">
          <Field label={t.pov}>
            <Input
              maxLength={100}
              value={rules.pov}
              onChange={(e) => change({ pov: e.target.value })}
            />
          </Field>
          <Field label={t.tense}>
            <Input
              maxLength={30}
              value={rules.tense}
              onChange={(e) => change({ tense: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t.tone}>
          <Textarea
            rows={3}
            maxLength={800}
            value={rules.tone}
            onChange={(e) => change({ tone: e.target.value })}
          />
        </Field>
        <p className="text-dim">{t.targetsHint}</p>
        <div className="planning-options">
          {(['sentenceLength', 'dialogueRatio'] as const).map((key) => {
            const label = key === 'sentenceLength' ? t.sentence : t.dialogue;
            const scale = key === 'dialogueRatio' ? 100 : 1;
            return (
              <div key={key} className="style-target-range">
                <span>{label}</span>
                <div>
                  {(['min', 'max'] as const).map((edge) => (
                    <Field key={edge} label={`${label} · ${t[edge]}`}>
                      <Input
                        type="number"
                        min={0}
                        max={key === 'sentenceLength' ? 300 : 100}
                        step={1}
                        value={
                          Number.isFinite(rules[key][edge])
                            ? Number((rules[key][edge] * scale).toFixed(2))
                            : ''
                        }
                        onChange={(e) =>
                          change({
                            [key]: {
                              ...rules[key],
                              [edge]: e.target.value === '' ? NaN : Number(e.target.value) / scale,
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <Field label={t.banned}>
          <Textarea
            rows={2}
            value={rules.bannedPhrases.join('\n')}
            onChange={(e) => change({ bannedPhrases: e.target.value.split('\n') })}
          />
        </Field>
        <Field label={t.arc} hint={t.arcHint}>
          <Textarea
            rows={2}
            maxLength={800}
            value={rules.styleArc}
            onChange={(e) => change({ styleArc: e.target.value })}
          />
        </Field>
      </fieldset>
      <div className="planning-editor-actions">
        <Button
          variant="human"
          disabled={stale || pending || !validStyleSelection(value)}
          disabledReason={stale ? t.staleEdit : t.invalid}
          loading={pending}
          onClick={onSave}
        >
          {t.adopt}
        </Button>
        <Button disabled={pending} onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </section>
  );
}
