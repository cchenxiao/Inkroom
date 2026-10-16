import { Field, Input, Textarea } from '@/shared/ui';
import { styleTrialMessages as t } from '@/shared/lib/messages-style-trial';
import type { TrialSetup } from '../types/style-trial';
export const lines = (text: string) =>
  text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
export function emptyTrialSetup(): TrialSetup {
  return {
    beat: { summary: '', facts: [], outcome: '', pov: '', tense: '' },
    variants: t.defaults.map((v) => ({ ...v, anchorText: '', bannedPhrases: [] })),
  };
}
export function validSetup(value: TrialSetup) {
  const b = value.beat;
  return Boolean(
    b.summary.trim() &&
    b.outcome.trim() &&
    b.pov.trim() &&
    b.tense.trim() &&
    value.variants.every((v) => v.label.trim() && v.instructions.trim()) &&
    value.variants[0].instructions.trim() !== value.variants[1].instructions.trim(),
  );
}
export default function StyleTrialSetup({
  value,
  disabled,
  onChange,
}: {
  value: TrialSetup;
  disabled: boolean;
  onChange: (value: TrialSetup) => void;
}) {
  const beat = (key: keyof TrialSetup['beat'], next: string | string[]) =>
    onChange({ ...value, beat: { ...value.beat, [key]: next } });
  return (
    <fieldset disabled={disabled} className="planning-intake">
      <Field label={t.summary} hint={t.summaryHint}>
        <Textarea
          rows={3}
          maxLength={1000}
          value={value.beat.summary}
          onChange={(e) => beat('summary', e.target.value)}
        />
      </Field>
      <div className="planning-options">
        <Field label={t.facts}>
          <Textarea
            rows={3}
            value={value.beat.facts.join('\n')}
            onChange={(e) => beat('facts', e.target.value.split('\n'))}
          />
        </Field>
        <Field label={t.outcome}>
          <Textarea
            rows={3}
            maxLength={400}
            value={value.beat.outcome}
            onChange={(e) => beat('outcome', e.target.value)}
          />
        </Field>
        <Field label={t.pov}>
          <Input
            maxLength={100}
            value={value.beat.pov}
            onChange={(e) => beat('pov', e.target.value)}
          />
        </Field>
        <Field label={t.tense}>
          <Input
            maxLength={30}
            value={value.beat.tense}
            onChange={(e) => beat('tense', e.target.value)}
          />
        </Field>
      </div>
      <div className="style-trial-pair">
        {value.variants.map((v, index) => {
          const change = (patch: Partial<typeof v>) =>
            onChange({
              ...value,
              variants: value.variants.map((x, i) => (i === index ? { ...x, ...patch } : x)),
            });
          return (
            <div className="style-trial-variant" key={v.id}>
              <Field label={`${t.label} ${index + 1}`}>
                <Input
                  maxLength={65}
                  value={v.label}
                  onChange={(e) => change({ label: e.target.value })}
                />
              </Field>
              <Field label={`${t.instructions} ${index + 1}`}>
                <Textarea
                  rows={4}
                  maxLength={660}
                  value={v.instructions}
                  onChange={(e) => change({ instructions: e.target.value })}
                />
              </Field>
              <details>
                <summary>{t.reference}</summary>
                <Textarea
                  aria-label={`${t.reference} ${index + 1}`}
                  rows={3}
                  maxLength={2000}
                  value={v.anchorText}
                  onChange={(e) => change({ anchorText: e.target.value })}
                />
              </details>
              <Field label={`${t.banned} ${index + 1}`}>
                <Textarea
                  rows={2}
                  value={v.bannedPhrases.join('\n')}
                  onChange={(e) => change({ bannedPhrases: e.target.value.split('\n') })}
                />
              </Field>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
