import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/shared/ui';
import { outlineMessages as t } from '@/shared/lib/messages-outline';
import type { CoreSelection } from '../types/core-settings';
import type { OutlineContent, OutlineSaveRequest } from '../types/outline';
export function outlineTextError(c: OutlineContent): string {
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  for (const act of c.acts) {
    if (bytes(act.title) > 150) return `${t.actTitle}「${act.title.slice(0, 12)}」：${t.tooLong}`;
    if (bytes(act.purpose) > 600) return `${t.actPurpose}「${act.title}」：${t.tooLong}`;
  }
  for (const chapter of c.chapters) {
    if (bytes(chapter.title) > 150) return `${t.titleLabel}：${t.tooLong}`;
    for (const field of ['purpose', 'event', 'arc', 'reveal', 'withhold'] as const) {
      if (bytes(chapter[field]) > 600) return `${chapter.title} · ${t[field]}：${t.tooLong}`;
    }
  }
  if (c.bindings.style.some((b) => bytes(b.guidance) > 600)) return `${t.style}：${t.tooLong}`;
  if (c.bindings.plans.some((b) => bytes(b.purpose) > 600)) return `${t.planPurpose}：${t.tooLong}`;
  return '';
}
export function outlineInvalid(c: OutlineContent, core: CoreSelection) {
  const chars = new Set(
    core.content.characters.filter((x) => core.decisions[x.id] === 'confirmed').map((x) => x.id),
  );
  const plans = new Set(
    core.content.plans.filter((x) => core.decisions[x.id] === 'confirmed').map((x) => x.id),
  );
  const chapters = new Set(c.chapters.map((x) => x.id));
  const acts = new Set(c.acts.map((x) => x.id));
  return (
    c.acts.length < 1 ||
    c.acts.length > 5 ||
    c.chapters.length < 2 ||
    c.chapters.length > 12 ||
    new Set([...acts, ...chapters]).size !== c.acts.length + c.chapters.length ||
    c.acts.some(
      (a) => !a.title.trim() || !a.purpose.trim() || !c.chapters.some((ch) => ch.actId === a.id),
    ) ||
    c.chapters.some(
      (ch) =>
        !ch.title.trim() ||
        !ch.purpose.trim() ||
        !ch.event.trim() ||
        !ch.arc.trim() ||
        !acts.has(ch.actId) ||
        !ch.characterIds.length ||
        ch.characterIds.some((id) => !chars.has(id)) ||
        !Number.isInteger(ch.targetWords) ||
        ch.targetWords < 100 ||
        ch.targetWords > 20000 ||
        (ch.storyTime !== null && (!Number.isInteger(ch.storyTime) || ch.storyTime < 0)),
    ) ||
    c.bindings.style.some((b) => !chapters.has(b.chapterId) || !b.guidance.trim()) ||
    c.bindings.plans.some(
      (b) =>
        !plans.has(b.planId) ||
        !b.chapterIds.length ||
        b.chapterIds.some((id) => !chapters.has(id)) ||
        !b.purpose.trim(),
    )
  );
}
export default function OutlineEditor({
  value,
  core,
  onChange,
  onSave,
  onClose,
  disabled,
  saving,
}: {
  value: OutlineSaveRequest;
  core: CoreSelection;
  onChange: (v: OutlineSaveRequest) => void;
  onSave: (confirmed: boolean) => void;
  onClose: () => void;
  disabled: boolean;
  saving: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);
  const [selected, setSelected] = useState(value.content.chapters[0].id);
  const [checked, setChecked] = useState(false);
  const c = value.content;
  const ch = c.chapters.find((x) => x.id === selected) ?? c.chapters[0];
  const index = c.chapters.findIndex((x) => x.id === ch.id);
  const update = (fn: (c: OutlineContent) => void) => {
    const next = structuredClone(value);
    fn(next.content);
    next.confirmed = false;
    setChecked(false);
    onChange(next);
  };
  const patch = (
    field: 'title' | 'purpose' | 'event' | 'arc' | 'reveal' | 'withhold',
    text: string,
  ) =>
    update((out) => {
      out.chapters[index][field] = text;
    });
  const chars = core.content.characters.filter((x) => core.decisions[x.id] === 'confirmed');
  const charIDs = [...new Set([...chars.map((x) => x.id), ...ch.characterIds])];
  const plans = core.content.plans.filter((x) => core.decisions[x.id] === 'confirmed');
  const planIDs = [
    ...new Set([...plans.map((x) => x.id), ...c.bindings.plans.map((x) => x.planId)]),
  ];
  const textError = outlineTextError(c);
  const invalid = outlineInvalid(c, core) || Boolean(textError);
  return (
    <section ref={ref} className="outline-editor" aria-label={t.editor}>
      <h3>{t.editor}</h3>
      <p className="muted">{t.editing}</p>
      <fieldset disabled={saving}>
        <details className="outline-acts">
          <summary>{t.acts}</summary>
          {c.acts.map((a, i) => (
            <div className="outline-act" key={a.id}>
              <label>
                {t.actTitle}
                <input
                  value={a.title}
                  onChange={(e) =>
                    update((o) => {
                      o.acts[i].title = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                {t.actPurpose}
                <textarea
                  rows={2}
                  value={a.purpose}
                  onChange={(e) =>
                    update((o) => {
                      o.acts[i].purpose = e.target.value;
                    })
                  }
                />
              </label>
              <Button
                size="sm"
                disabled={c.acts.length === 1 || c.chapters.some((ch) => ch.actId === a.id)}
                disabledReason={t.actInUse}
                onClick={() =>
                  update((o) => {
                    o.acts = o.acts.filter((x) => x.id !== a.id);
                  })
                }
              >
                {t.removeAct}
              </Button>
            </div>
          ))}
          <Button
            disabled={c.acts.length >= 5}
            onClick={() =>
              update((o) =>
                o.acts.push({ id: `act-${crypto.randomUUID()}`, title: t.newAct, purpose: '' }),
              )
            }
          >
            {t.addAct}
          </Button>
        </details>
        <div className="outline-split">
          <nav aria-label={t.editor}>
            {c.chapters.map((chapter, i) => (
              <button
                type="button"
                key={chapter.id}
                aria-current={ch.id === chapter.id ? 'true' : undefined}
                onClick={() => setSelected(chapter.id)}
              >
                <small>
                  {i + 1} · {c.acts.find((a) => a.id === chapter.actId)?.title}
                </small>
                <strong>{chapter.title}</strong>
                <span>
                  {chapter.targetWords.toLocaleString()} {t.words}
                </span>
              </button>
            ))}
            <Button
              disabled={c.chapters.length >= 12}
              onClick={() => {
                const id = `chapter-${crypto.randomUUID()}`;
                update((o) =>
                  o.chapters.push({
                    id,
                    actId: c.acts[c.acts.length - 1].id,
                    title: t.newChapter,
                    purpose: '',
                    event: '',
                    arc: '',
                    reveal: '',
                    withhold: '',
                    characterIds: [],
                    targetWords: 3000,
                    storyTime: null,
                  }),
                );
                setSelected(id);
              }}
            >
              {t.addChapter}
            </Button>
          </nav>
          <div className="outline-detail">
            <div className="core-heading">
              <h3>
                {index + 1} · {ch.title}
              </h3>
              <div className="page-actions">
                <Button
                  size="icon"
                  aria-label={t.moveUp}
                  disabled={index === 0}
                  onClick={() =>
                    update((o) => {
                      [o.chapters[index - 1], o.chapters[index]] = [
                        o.chapters[index],
                        o.chapters[index - 1],
                      ];
                    })
                  }
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  size="icon"
                  aria-label={t.moveDown}
                  disabled={index === c.chapters.length - 1}
                  onClick={() =>
                    update((o) => {
                      [o.chapters[index + 1], o.chapters[index]] = [
                        o.chapters[index],
                        o.chapters[index + 1],
                      ];
                    })
                  }
                >
                  <ArrowDown size={14} />
                </Button>
                <Button
                  size="sm"
                  disabled={c.chapters.length <= 2}
                  onClick={() => {
                    if (!window.confirm(t.removeConfirm)) return;
                    update((o) => {
                      o.chapters = o.chapters.filter((x) => x.id !== ch.id);
                      o.bindings.style = o.bindings.style.filter((b) => b.chapterId !== ch.id);
                      o.bindings.plans = o.bindings.plans
                        .map((b) => ({
                          ...b,
                          chapterIds: b.chapterIds.filter((id) => id !== ch.id),
                        }))
                        .filter((b) => b.chapterIds.length);
                    });
                  }}
                >
                  {t.removeChapter}
                </Button>
              </div>
            </div>
            <div className="core-fields">
              <label>
                {t.titleLabel}
                <input value={ch.title} onChange={(e) => patch('title', e.target.value)} />
              </label>
              <label>
                {t.act}
                <select
                  value={ch.actId}
                  onChange={(e) =>
                    update((o) => {
                      o.chapters[index].actId = e.target.value;
                    })
                  }
                >
                  {c.acts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(['purpose', 'event', 'arc', 'reveal', 'withhold'] as const).map((field) => (
              <label key={field}>
                {t[field]}
                <textarea
                  rows={2}
                  value={ch[field]}
                  onChange={(e) => patch(field, e.target.value)}
                />
              </label>
            ))}
            <div className="core-fields">
              <label>
                {t.targetWords}
                <input
                  type="number"
                  min={100}
                  max={20000}
                  step={100}
                  value={ch.targetWords}
                  onChange={(e) =>
                    update((o) => {
                      o.chapters[index].targetWords = Number(e.target.value);
                    })
                  }
                />
              </label>
              <label>
                {t.storyTime}
                <input
                  type="number"
                  min={0}
                  value={ch.storyTime ?? ''}
                  onChange={(e) =>
                    update((o) => {
                      o.chapters[index].storyTime =
                        e.target.value === '' ? null : Number(e.target.value);
                    })
                  }
                />
              </label>
            </div>
            <fieldset className="core-relations">
              <legend>{t.characters}</legend>
              {charIDs.map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={ch.characterIds.includes(id)}
                    onChange={(e) =>
                      update((o) => {
                        o.chapters[index].characterIds = e.target.checked
                          ? [...ch.characterIds, id]
                          : ch.characterIds.filter((x) => x !== id);
                      })
                    }
                  />
                  {chars.find((x) => x.id === id)?.name ?? `${t.orphan}：${id}`}
                </label>
              ))}
            </fieldset>
            <label>
              {t.style}
              <textarea
                rows={2}
                placeholder={t.styleHint}
                value={c.bindings.style.find((b) => b.chapterId === ch.id)?.guidance ?? ''}
                onChange={(e) =>
                  update((o) => {
                    o.bindings.style = o.bindings.style.filter((b) => b.chapterId !== ch.id);
                    if (e.target.value.trim())
                      o.bindings.style.push({ chapterId: ch.id, guidance: e.target.value });
                  })
                }
              />
            </label>
            <fieldset className="core-relations">
              <legend>{t.plans}</legend>
              {!planIDs.length && <p>{t.noPlans}</p>}
              {planIDs.map((id) => {
                const binding = c.bindings.plans.find((b) => b.planId === id);
                const included = Boolean(binding?.chapterIds.includes(ch.id));
                return (
                  <div key={id}>
                    <p>{plans.find((p) => p.id === id)?.intent ?? `${t.orphan}：${id}`}</p>
                    <label>
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={(e) =>
                          update((o) => {
                            const b = o.bindings.plans.find((b) => b.planId === id);
                            if (e.target.checked) {
                              if (b) b.chapterIds.push(ch.id);
                              else
                                o.bindings.plans.push({
                                  planId: id,
                                  chapterIds: [ch.id],
                                  purpose: '',
                                });
                            } else if (b) {
                              b.chapterIds = b.chapterIds.filter((x) => x !== ch.id);
                              o.bindings.plans = o.bindings.plans.filter(
                                (x) => x.chapterIds.length,
                              );
                            }
                          })
                        }
                      />
                      {t.planUse}
                    </label>
                    {included && (
                      <label>
                        {t.planPurpose}
                        <textarea
                          rows={2}
                          value={binding?.purpose ?? ''}
                          onChange={(e) =>
                            update((o) => {
                              o.bindings.plans.find((b) => b.planId === id)!.purpose =
                                e.target.value;
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </fieldset>
          </div>
        </div>
      </fieldset>
      {invalid && <p role="alert">{textError || t.invalid}</p>}
      <div className="core-save">
        <label className="outline-check">
          <input
            type="checkbox"
            checked={checked}
            disabled={saving || disabled}
            onChange={(e) => setChecked(e.target.checked)}
          />
          {t.checked}
        </label>
        <Button disabled={saving} onClick={onClose}>
          {t.close}
        </Button>
        <Button
          disabled={saving || disabled || invalid}
          disabledReason={disabled ? t.stale : invalid ? textError || t.invalid : undefined}
          onClick={() => onSave(false)}
        >
          {t.saveDraft}
        </Button>
        <Button
          variant="human"
          disabled={saving || disabled || invalid || !checked}
          disabledReason={
            disabled ? t.stale : invalid ? textError || t.invalid : !checked ? t.checked : undefined
          }
          onClick={() => onSave(true)}
        >
          {t.confirm}
        </Button>
      </div>
    </section>
  );
}
