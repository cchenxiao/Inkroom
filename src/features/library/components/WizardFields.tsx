import type { PlanContent, WorldDraft, OutlineDraft } from '@/types/domain/library';
import { Field, Input, Textarea } from '@/shared/ui';
import { wizardMessages as m } from '@/shared/lib/messages-wizard';

export function WizardFields({
  content,
  disabled,
  onChange,
}: {
  content: PlanContent;
  disabled: boolean;
  onChange: (content: PlanContent) => void;
}) {
  const text = (
    label: string,
    value: string,
    change: (value: string) => void,
    multiline = false,
  ) => (
    <Field label={label} key={label}>
      {multiline ? (
        <Textarea
          aria-label={label}
          value={value}
          rows={3}
          disabled={disabled}
          onChange={(event) => change(event.target.value)}
        />
      ) : (
        <Input
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) => change(event.target.value)}
        />
      )}
    </Field>
  );
  const number = (label: string, value: number, change: (value: number) => void, max?: number) => (
    <Field label={label}>
      {
        <Input
          type="number"
          aria-label={label}
          value={Number.isFinite(value) ? value : ''}
          min={0}
          max={max}
          disabled={disabled}
          onChange={(event) => change(event.target.valueAsNumber)}
        />
      }
    </Field>
  );
  if (content.kind === 'direction')
    return (
      <div className="wizard-fields">
        {text(m.tone, content.tone, (tone) => onChange({ ...content, tone }))}
        {text(
          m.coreConflict,
          content.coreConflict,
          (coreConflict) => onChange({ ...content, coreConflict }),
          true,
        )}
        {text(m.appeal, content.appeal, (appeal) => onChange({ ...content, appeal }), true)}
        {text(m.note, content.note, (note) => onChange({ ...content, note }), true)}
      </div>
    );
  if (content.kind === 'style')
    return (
      <div className="wizard-fields">
        <div className="wizard-field-grid">
          {text(m.pov, content.pov, (pov) => onChange({ ...content, pov }))}
          {text(m.tense, content.tense, (tense) => onChange({ ...content, tense }))}
        </div>
        <div className="wizard-field-grid">
          {number(m.sentenceMin, content.sentenceMin, (sentenceMin) =>
            onChange({ ...content, sentenceMin }),
          )}
          {number(m.sentenceMax, content.sentenceMax, (sentenceMax) =>
            onChange({ ...content, sentenceMax }),
          )}
          {number(
            m.dialogueMin,
            content.dialogueMin,
            (dialogueMin) => onChange({ ...content, dialogueMin }),
            100,
          )}
          {number(
            m.dialogueMax,
            content.dialogueMax,
            (dialogueMax) => onChange({ ...content, dialogueMax }),
            100,
          )}
        </div>
        {text(m.bannedWords, content.bannedWords.join('，'), (value) =>
          onChange({ ...content, bannedWords: value.split(/[,，、]/) }),
        )}
        {text(m.styleArc, content.styleArc, (styleArc) => onChange({ ...content, styleArc }), true)}
      </div>
    );
  if (content.kind === 'world') {
    const character = (index: number, patch: Partial<WorldDraft['characters'][number]>) =>
      onChange({
        ...content,
        characters: content.characters.map((item, i) =>
          i === index ? { ...item, confirmed: false, ...patch } : item,
        ),
      });
    return (
      <div className="wizard-fields">
        <h3>{m.characters}</h3>
        {content.characters.map((item, index) => (
          <section className="wizard-subcard" key={item.id}>
            {text(m.characterName, item.name, (name) => character(index, { name }))}
            <div className="wizard-field-grid">
              {text(m.want, item.want, (want) => character(index, { want }), true)}
              {text(m.need, item.need, (need) => character(index, { need }), true)}
              {text(m.flaw, item.flaw, (flaw) => character(index, { flaw }), true)}
              {text(m.arc, item.arc, (arc) => character(index, { arc }), true)}
            </div>
            {text(
              m.hardTraits,
              item.hardTraits,
              (hardTraits) => character(index, { hardTraits }),
              true,
            )}
            <label className="wizard-confirm">
              <input
                type="checkbox"
                checked={item.confirmed}
                disabled={disabled}
                onChange={(event) => character(index, { confirmed: event.target.checked })}
              />
              {m.confirmCharacter}
            </label>
          </section>
        ))}
        <h3>{m.rules}</h3>
        {content.rules.map((item, index) => (
          <section className="wizard-subcard" key={item.id}>
            {text(
              m.ruleNumber(index),
              item.text,
              (value) =>
                onChange({
                  ...content,
                  rules: content.rules.map((rule, i) =>
                    i === index ? { ...rule, text: value, confirmed: false } : rule,
                  ),
                }),
              true,
            )}
            <label className="wizard-confirm">
              <input
                type="checkbox"
                checked={item.confirmed}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...content,
                    rules: content.rules.map((rule, i) =>
                      i === index ? { ...rule, confirmed: event.target.checked } : rule,
                    ),
                  })
                }
              />
              {m.confirmRule}
            </label>
          </section>
        ))}
      </div>
    );
  }
  const chapter = (index: number, patch: Partial<OutlineDraft['chapters'][number]>) =>
    onChange({
      ...content,
      chapters: content.chapters.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  return (
    <div className="wizard-fields">
      <h3>{m.acts}</h3>
      {content.acts.map((act, actIndex) => (
        <section className="wizard-subcard" key={act.id}>
          {text(m.actTitle, act.title, (title) =>
            onChange({
              ...content,
              acts: content.acts.map((item, i) => (i === actIndex ? { ...item, title } : item)),
            }),
          )}
          {content.chapters.map((item, index) =>
            item.actId !== act.id ? null : (
              <div className="wizard-chapter" key={item.id}>
                <h4>{m.chapterNumber(index)}</h4>
                {text(m.chapterTitle, item.title, (title) => chapter(index, { title }))}
                {text(
                  m.chapterPurpose,
                  item.purpose,
                  (purpose) => chapter(index, { purpose }),
                  true,
                )}
                {index === 0 ? (
                  <div className="wizard-scenes">
                    <h4>{m.firstChapter}</h4>
                    {item.scenes.map((scene, sceneIndex) => (
                      <section className="wizard-subcard" key={scene.id}>
                        <small>{m.sceneNumber(sceneIndex)}</small>
                        {text(m.sceneTitle, scene.title, (title) =>
                          chapter(index, {
                            scenes: item.scenes.map((value, i) =>
                              i === sceneIndex ? { ...value, title } : value,
                            ),
                          }),
                        )}
                        {scene.beats.map((beat, beatIndex) => (
                          <div className="wizard-beat" key={beat.id}>
                            {text(m.beatTitle, beat.title, (title) =>
                              chapter(index, {
                                scenes: item.scenes.map((value, i) =>
                                  i === sceneIndex
                                    ? {
                                        ...value,
                                        beats: value.beats.map((valueBeat, j) =>
                                          j === beatIndex ? { ...valueBeat, title } : valueBeat,
                                        ),
                                      }
                                    : value,
                                ),
                              }),
                            )}
                            {text(
                              m.beatDescription,
                              beat.description,
                              (description) =>
                                chapter(index, {
                                  scenes: item.scenes.map((value, i) =>
                                    i === sceneIndex
                                      ? {
                                          ...value,
                                          beats: value.beats.map((valueBeat, j) =>
                                            j === beatIndex
                                              ? { ...valueBeat, description }
                                              : valueBeat,
                                          ),
                                        }
                                      : value,
                                  ),
                                }),
                              true,
                            )}
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="wizard-muted">{m.laterChapter}</p>
                )}
              </div>
            ),
          )}
        </section>
      ))}
    </div>
  );
}
