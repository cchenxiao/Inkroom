import { Button, Field, Input, Textarea } from '@/shared/ui';
import { planningMessages as t } from '@/shared/lib/messages-planning';
import type { PlanningIntake, PlanningPack } from '../types/planning';
export const emptyIntake: PlanningIntake = {
  premise: '',
  genres: '',
  targetWords: '',
  narrative: '',
  preferences: '',
  references: [],
  packs: [],
};
export default function PlanningIntakeForm({
  value,
  packs,
  disabled,
  onChange,
}: {
  value: PlanningIntake;
  packs: PlanningPack[];
  disabled: boolean;
  onChange: (value: PlanningIntake) => void;
}) {
  const refs = value.references ?? [];
  const chosen = value.packs ?? [];
  return (
    <fieldset className="planning-intake" disabled={disabled}>
      <Field label={t.premise}>
        <Textarea
          rows={3}
          maxLength={1800}
          value={value.premise}
          placeholder={t.placeholder}
          onChange={(e) => onChange({ ...value, premise: e.target.value })}
        />
      </Field>
      <details>
        <summary>{t.options}</summary>
        <div className="planning-options">
          {(['genres', 'targetWords', 'narrative', 'preferences'] as const).map((key) => (
            <Field key={key} label={key === 'targetWords' ? t.words : t[key]}>
              <Input
                maxLength={key === 'preferences' ? 900 : key === 'targetWords' ? 30 : 100}
                value={value[key]}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <div className="planning-reference-list">
          <h3>{t.references}</h3>
          <p className="text-dim">{t.refNote}</p>
          {refs.map((ref, i) => (
            <div className="planning-reference" key={i}>
              <Input
                aria-label={`${t.refTitle} ${i + 1}`}
                placeholder={t.refTitle}
                maxLength={90}
                value={ref.title}
                onChange={(e) =>
                  onChange({
                    ...value,
                    references: refs.map((r, n) => (n === i ? { ...r, title: e.target.value } : r)),
                  })
                }
              />
              <Input
                aria-label={`${t.refDimension} ${i + 1}`}
                placeholder={t.refDimension}
                maxLength={300}
                value={ref.dimension}
                onChange={(e) =>
                  onChange({
                    ...value,
                    references: refs.map((r, n) =>
                      n === i ? { ...r, dimension: e.target.value } : r,
                    ),
                  })
                }
              />
              <Button
                onClick={() => onChange({ ...value, references: refs.filter((_, n) => n !== i) })}
              >
                {t.remove}
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            disabled={refs.length >= 5}
            disabledReason={t.maxReferences}
            onClick={() =>
              onChange({ ...value, references: [...refs, { title: '', dimension: '' }] })
            }
          >
            {t.addRef}
          </Button>
        </div>
        <h3>{t.packs}</h3>
        <p className="text-dim">{t.packNote}</p>
        <div className="planning-pack-list">
          {packs.map((pack) => (
            <label key={pack.id} title={pack.guidance}>
              <input
                type="checkbox"
                checked={chosen.some((p) => p.id === pack.id)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    packs: e.target.checked
                      ? [...chosen, { id: pack.id, version: pack.version }]
                      : chosen.filter((p) => p.id !== pack.id),
                  })
                }
              />
              {pack.name} <small>v{pack.version}</small>
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
