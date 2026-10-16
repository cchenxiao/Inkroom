import { useEffect, useRef } from 'react';
import { Button } from '@/shared/ui';
import { coreSettingsMessages as t } from '@/shared/lib/messages-core-settings';
import type { CoreContent, CoreDecision, CoreSaveRequest } from '../types/core-settings';

export function pendingDecisions(content: CoreContent): Record<string, CoreDecision> {
  return Object.fromEntries(
    [...content.characters, ...content.worldFacts, ...content.plans].map((i) => [i.id, 'pending']),
  );
}
export function hasIncompleteDependencies(edit: CoreSaveRequest) {
  const confirmed = (id: string) => id === 'world' || edit.decisions[id] === 'confirmed';
  return (
    edit.content.characters.some(
      (c) => confirmed(c.id) && c.hardFactIds.some((id) => !confirmed(id)),
    ) ||
    edit.content.worldFacts.some(
      (f) =>
        confirmed(f.id) &&
        (!confirmed(f.subject) || f.knownBy.some((k) => !confirmed(k.characterId))),
    ) ||
    edit.content.plans.some((p) => confirmed(p.id) && !confirmed(p.subject))
  );
}
export default function CoreSettingsEditor({
  value,
  onChange,
  onSave,
  onClose,
  disabled,
  saving,
}: {
  value: CoreSaveRequest;
  onChange: (value: CoreSaveRequest) => void;
  onSave: () => void;
  onClose: () => void;
  disabled: boolean;
  saving: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);
  const { content, decisions } = value;
  const update = (id: string, mutate: (content: CoreContent) => void) => {
    const next = structuredClone(value);
    mutate(next.content);
    next.decisions[id] = 'pending';
    onChange(next);
  };
  const decision = (id: string, label: string) => (
    <label className="core-decision">
      {label}
      <select
        aria-label={`${label} · 状态`}
        value={decisions[id]}
        onChange={(e) =>
          onChange({ ...value, decisions: { ...decisions, [id]: e.target.value as CoreDecision } })
        }
      >
        {(['pending', 'confirmed', 'rejected'] as const).map((s) => (
          <option key={s} value={s}>
            {t[s]}
          </option>
        ))}
      </select>
    </label>
  );
  const subject = (id: string, current: string, set: (c: CoreContent, v: string) => void) => (
    <label>
      {t.subject}
      <select value={current} onChange={(e) => update(id, (c) => set(c, e.target.value))}>
        <option value="world">{t.world}</option>
        {content.characters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
  const incomplete = hasIncompleteDependencies(value);
  return (
    <section ref={ref} className="core-editor" aria-label={t.editor}>
      <h3>{t.editor}</h3>
      <p className="muted">{t.editingHint}</p>
      <fieldset disabled={saving}>
        <h3>{t.characters}</h3>
        <p className="muted">{t.characterHint}</p>
        {content.characters.map((character, index) => (
          <article className="core-item" key={character.id}>
            {decision(character.id, character.name)}
            <div className="core-fields">
              {(['name', 'role', 'want', 'need', 'flaw', 'arcIntent'] as const).map((field) => (
                <label key={field}>
                  {t[field]}
                  <textarea
                    rows={2}
                    value={character[field]}
                    onChange={(e) =>
                      update(character.id, (c) => {
                        c.characters[index][field] = e.target.value;
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              {t.voice}
              <textarea
                rows={2}
                value={character.voice.join('\n')}
                onChange={(e) =>
                  update(character.id, (c) => {
                    c.characters[index].voice = e.target.value.split('\n');
                  })
                }
              />
            </label>
            <fieldset className="core-relations">
              <legend>{t.hardFacts}</legend>
              {content.worldFacts
                .filter((f) => f.rigidity === 'hard')
                .map((f) => (
                  <label key={f.id}>
                    <input
                      type="checkbox"
                      checked={character.hardFactIds.includes(f.id)}
                      onChange={(e) =>
                        update(character.id, (c) => {
                          c.characters[index].hardFactIds = e.target.checked
                            ? [...character.hardFactIds, f.id]
                            : character.hardFactIds.filter((id) => id !== f.id);
                        })
                      }
                    />
                    {f.text}
                  </label>
                ))}
              {!content.worldFacts.some((f) => f.rigidity === 'hard') && <p>{t.noHardFacts}</p>}
            </fieldset>
          </article>
        ))}
        <h3>{t.facts}</h3>
        <p className="muted">{t.factHint}</p>
        {!content.worldFacts.length && <p>{t.none}</p>}
        {content.worldFacts.map((fact, index) => (
          <article className="core-item" key={fact.id}>
            {decision(fact.id, `${t.facts} ${index + 1}`)}
            <label>
              {t.factText}
              <textarea
                rows={3}
                value={fact.text}
                onChange={(e) =>
                  update(fact.id, (c) => {
                    c.worldFacts[index].text = e.target.value;
                  })
                }
              />
            </label>
            <div className="core-fields">
              {subject(fact.id, fact.subject, (c, v) => {
                c.worldFacts[index].subject = v;
              })}
              <label>
                {t.rigidity}
                <select
                  value={fact.rigidity}
                  onChange={(e) =>
                    update(fact.id, (c) => {
                      c.worldFacts[index].rigidity = e.target.value as 'hard' | 'soft';
                    })
                  }
                >
                  <option value="hard">{t.hard}</option>
                  <option
                    value="soft"
                    disabled={content.characters.some((c) => c.hardFactIds.includes(fact.id))}
                  >
                    {t.soft}
                  </option>
                </select>
                {content.characters.some((c) => c.hardFactIds.includes(fact.id)) && (
                  <small>{t.referencedHard}</small>
                )}
              </label>
              <label>
                {t.storyTime}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={fact.storyTime ?? ''}
                  onChange={(e) =>
                    update(fact.id, (c) => {
                      c.worldFacts[index].storyTime =
                        e.target.value === '' ? null : Number(e.target.value);
                    })
                  }
                />
              </label>
            </div>
            <fieldset className="core-relations">
              <legend>{t.knownBy}</legend>
              {content.characters.map((character) => {
                const known = fact.knownBy.find((k) => k.characterId === character.id);
                return (
                  <div key={character.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(known)}
                        onChange={(e) =>
                          update(fact.id, (c) => {
                            c.worldFacts[index].knownBy = e.target.checked
                              ? [...fact.knownBy, { characterId: character.id, learnedAt: null }]
                              : fact.knownBy.filter((k) => k.characterId !== character.id);
                          })
                        }
                      />
                      {character.name}
                    </label>
                    {known && (
                      <label>
                        {t.learnedAt}
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={known.learnedAt ?? ''}
                          onChange={(e) =>
                            update(fact.id, (c) => {
                              c.worldFacts[index].knownBy = c.worldFacts[index].knownBy.map((k) =>
                                k.characterId === character.id
                                  ? {
                                      ...k,
                                      learnedAt:
                                        e.target.value === '' ? null : Number(e.target.value),
                                    }
                                  : k,
                              );
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </fieldset>
          </article>
        ))}
        <h3>{t.plans}</h3>
        <p className="muted">{t.planHint}</p>
        {!content.plans.length && <p>{t.none}</p>}
        {content.plans.map((plan, index) => (
          <article className="core-item" key={plan.id}>
            {decision(plan.id, `${t.plans} ${index + 1}`)}
            {subject(plan.id, plan.subject, (c, v) => {
              c.plans[index].subject = v;
            })}
            <label>
              {t.intent}
              <textarea
                rows={3}
                value={plan.intent}
                onChange={(e) =>
                  update(plan.id, (c) => {
                    c.plans[index].intent = e.target.value;
                  })
                }
              />
            </label>
          </article>
        ))}
      </fieldset>
      {incomplete && <p role="alert">{t.dependency}</p>}
      <div className="core-save">
        <Button disabled={saving} onClick={onClose}>
          {t.close}
        </Button>
        <Button
          variant="human"
          disabled={disabled || saving || incomplete}
          disabledReason={incomplete ? t.dependency : disabled ? t.staleEdit : undefined}
          onClick={onSave}
        >
          {saving ? t.saving : t.save}
        </Button>
      </div>
    </section>
  );
}
