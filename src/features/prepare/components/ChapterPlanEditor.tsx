import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui';
import { chapterPlanMessages as t } from '@/shared/lib/messages-chapter-plan';
import type {
  ChapterPlanInput,
  ChapterPlanContent,
  ChapterPlanSaveRequest,
  PlannedScene,
} from '../types/chapter-plan';
import type { CoreSelection } from '../types/core-settings';
import type { OutlineChapter } from '../types/outline';

export function chapterPlanError(c: ChapterPlanContent, chapter: OutlineChapter) {
  if (
    c.targetWords != null &&
    c.targetWords !== 0 &&
    (!Number.isSafeInteger(c.targetWords) || c.targetWords < 200 || c.targetWords > 12000)
  )
    return '本章目标篇幅应为 200–12000 字';
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const beats = c.scenes.flatMap((s) => s.beats);
  const ids = [...c.scenes.map((s) => s.id), ...beats.map((b) => b.id)];
  if (
    c.scenes.length < 1 ||
    c.scenes.length > 4 ||
    beats.length > 8 ||
    new Set(ids).size !== ids.length ||
    !beats.some((b) => b.id === c.brief.selectedBeatId) ||
    c.scenes.some(
      (s) =>
        !s.title.trim() ||
        !s.goal.trim() ||
        !s.conflict.trim() ||
        !s.outcome.trim() ||
        s.beats.length < 1 ||
        s.beats.length > 4 ||
        s.characterIds.length < 1 ||
        s.characterIds.length > 3 ||
        new Set(s.characterIds).size !== s.characterIds.length ||
        s.characterIds.some((id) => !chapter.characterIds.includes(id)) ||
        !s.characterIds.includes(s.povCharacterId) ||
        (s.storyTime !== null && (!Number.isSafeInteger(s.storyTime) || s.storyTime < 0)),
    ) ||
    beats.some((b) => !b.title.trim() || !b.action.trim() || !b.turn.trim()) ||
    !c.brief.mustHappen.trim() ||
    !c.brief.cannotChange.trim() ||
    !c.brief.writingGuidance.trim()
  )
    return t.invalid;
  if (
    c.scenes.some(
      (s) => bytes(s.title) > 150 || [s.goal, s.conflict, s.outcome].some((v) => bytes(v) > 600),
    ) ||
    beats.some((b) => bytes(b.title) > 150 || bytes(b.action) > 600 || bytes(b.turn) > 600) ||
    [
      c.brief.mustHappen,
      c.brief.cannotChange,
      c.brief.reveal,
      c.brief.withhold,
      c.brief.writingGuidance,
    ].some((v) => bytes(v) > 900)
  )
    return t.tooLong;
  return '';
}
export default function ChapterPlanEditor({
  value,
  chapter,
  core,
  onChange,
  onSave,
  onClose,
  disabled,
  saving,
  previousChapter,
}: {
  previousChapter?: ChapterPlanInput['previousChapter'];
  value: ChapterPlanSaveRequest;
  chapter: OutlineChapter;
  core: CoreSelection;
  onChange: (v: ChapterPlanSaveRequest) => void;
  onSave: (confirmed: boolean) => void;
  onClose: () => void;
  disabled: boolean;
  saving: boolean;
}) {
  const [selected, setSelected] = useState(value.content.scenes[0]?.id);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);
  const content = value.content;
  const scene = content.scenes.find((s) => s.id === selected) ?? content.scenes[0];
  const chars = core.content.characters.filter(
    (c) => core.decisions[c.id] === 'confirmed' && chapter.characterIds.includes(c.id),
  );
  const change = (f: (c: ChapterPlanContent) => void) => {
    const c = structuredClone(content);
    f(c);
    onChange({ ...value, content: c, confirmed: false });
  };
  const update = (patch: Partial<PlannedScene>) =>
    change((c) =>
      Object.assign(
        c.scenes.find((s) => s.id === scene.id)!,
        patch,
      ),
    );
  const error = chapterPlanError(content, chapter);
  const allBeats = content.scenes.flatMap((s) => s.beats);
  const newBeat = () => ({ id: crypto.randomUUID(), title: '', action: '', turn: '' });
  const reorder = (id: string, d: number) =>
    change((c) => {
      const i = c.scenes.findIndex((s) => s.id === id),
        j = i + d;
      if (j >= 0 && j < c.scenes.length) [c.scenes[i], c.scenes[j]] = [c.scenes[j], c.scenes[i]];
    });
  return (
    <section className="outline-editor" ref={ref} aria-label={t.candidate}>
      <fieldset disabled={disabled || saving}>
        <div className="outline-split">
          <nav aria-label={t.scene}>
            {content.scenes.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-current={scene.id === s.id}
                onClick={() => setSelected(s.id)}
              >
                {i + 1}. {s.title || t.scene}
                <small>
                  {s.beats.length} {t.beat}
                </small>
              </button>
            ))}
            <Button
              disabled={content.scenes.length >= 4 || allBeats.length >= 8}
              disabledReason={t.invalid}
              onClick={() =>
                change((c) => {
                  const id = crypto.randomUUID();
                  c.scenes.push({
                    id,
                    title: '',
                    goal: '',
                    conflict: '',
                    outcome: '',
                    povCharacterId: chapter.characterIds[0],
                    characterIds: [chapter.characterIds[0]],
                    storyTime: chapter.storyTime,
                    beats: [newBeat()],
                  });
                  setSelected(id);
                })
              }
            >
              {t.addScene}
            </Button>
          </nav>
          <div className="outline-detail">
            <div className="core-heading">
              <h3>{t.scene}</h3>
              <Button
                size="sm"
                disabled={content.scenes[0].id === scene.id}
                onClick={() => reorder(scene.id, -1)}
              >
                {t.up}
              </Button>
              <Button
                size="sm"
                disabled={content.scenes.at(-1)?.id === scene.id}
                onClick={() => reorder(scene.id, 1)}
              >
                {t.down}
              </Button>
              <Button
                size="sm"
                disabled={content.scenes.length <= 1}
                onClick={() => {
                  if (window.confirm(t.removeConfirm))
                    change((c) => {
                      c.scenes = c.scenes.filter((s) => s.id !== scene.id);
                      if (
                        !c.scenes.some((s) => s.beats.some((b) => b.id === c.brief.selectedBeatId))
                      )
                        c.brief.selectedBeatId = c.scenes[0].beats[0].id;
                    });
                }}
              >
                {t.remove}
              </Button>
            </div>
            <label>
              {t.sceneTitle}
              <input value={scene.title} onChange={(e) => update({ title: e.target.value })} />
            </label>
            {(['goal', 'conflict', 'outcome'] as const).map((k) => (
              <label key={k}>
                {t[k]}
                <textarea
                  rows={2}
                  value={scene[k]}
                  onChange={(e) => update({ [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="chapter-plan-pair">
              <label>
                {t.pov}
                <select
                  value={scene.povCharacterId}
                  onChange={(e) =>
                    update({
                      povCharacterId: e.target.value,
                      characterIds: [...new Set([...scene.characterIds, e.target.value])],
                    })
                  }
                >
                  {!chars.some((c) => c.id === scene.povCharacterId) && (
                    <option value={scene.povCharacterId}>{scene.povCharacterId}</option>
                  )}
                  {chars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.storyTime}
                <input
                  type="number"
                  min={0}
                  value={scene.storyTime ?? ''}
                  onChange={(e) =>
                    update({ storyTime: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div>
              <p>{t.characters}</p>
              <div className="core-heading">
                {[...new Set([...chapter.characterIds, ...scene.characterIds])].map((id) => (
                  <label className="outline-check" key={id}>
                    <input
                      type="checkbox"
                      checked={scene.characterIds.includes(id)}
                      onChange={(e) =>
                        update({
                          characterIds: e.target.checked
                            ? [...scene.characterIds, id]
                            : scene.characterIds.filter((v) => v !== id),
                        })
                      }
                    />
                    {chars.find((c) => c.id === id)?.name ?? '人物名称暂缺，请检查人物设定'}
                  </label>
                ))}
              </div>
            </div>
            {scene.beats.map((b, i) => (
              <div className="chapter-plan-beat" key={b.id}>
                <div className="core-heading">
                  <h4>
                    {t.beat} {i + 1}
                  </h4>
                  {([-1, 1] as const).map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      disabled={i + d < 0 || i + d >= scene.beats.length}
                      onClick={() =>
                        change((c) => {
                          const arr = c.scenes.find((s) => s.id === scene.id)!.beats;
                          [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
                        })
                      }
                    >
                      {d < 0 ? t.up : t.down}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    disabled={scene.beats.length === 1}
                    onClick={() =>
                      change((c) => {
                        const s = c.scenes.find((s) => s.id === scene.id)!;
                        s.beats = s.beats.filter((x) => x.id !== b.id);
                        if (c.brief.selectedBeatId === b.id)
                          c.brief.selectedBeatId = c.scenes[0].beats[0].id;
                      })
                    }
                  >
                    {t.remove}
                  </Button>
                </div>
                {(['title', 'action', 'turn'] as const).map((k) => (
                  <label key={k}>
                    {k === 'title' ? t.beatTitle : t[k]}
                    <textarea
                      rows={k === 'title' ? 1 : 2}
                      value={b[k]}
                      onChange={(e) =>
                        change((c) => {
                          c.scenes
                            .find((s) => s.id === scene.id)!
                            .beats.find((x) => x.id === b.id)![k] = e.target.value;
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
            <Button
              disabled={scene.beats.length >= 4 || allBeats.length >= 8}
              disabledReason={t.invalid}
              onClick={() => update({ beats: [...scene.beats, newBeat()] })}
            >
              {t.addBeat}
            </Button>
          </div>
        </div>
        <div className="outline-detail chapter-plan-brief">
          <h3>{t.brief}</h3>
          <label>
            本章目标字数
            <input
              type="number"
              min={200}
              max={12000}
              step={100}
              value={content.targetWords === 0 ? '' : (content.targetWords ?? chapter.targetWords)}
              onChange={(e) =>
                change((c) => {
                  c.targetWords = Number(e.target.value);
                })
              }
            />
          </label>
          <p className="muted">
            按本章分配各段篇幅，不改变其他章节的规划。常规章节可设为 2000–3000 字。
          </p>
          <label>
            {t.selectedBeatId}
            <select
              value={content.brief.selectedBeatId}
              onChange={(e) =>
                change((c) => {
                  c.brief.selectedBeatId = e.target.value;
                })
              }
            >
              {content.scenes.flatMap((s) =>
                s.beats.map((b) => (
                  <option value={b.id} key={b.id}>
                    {s.title} · {b.title}
                  </option>
                )),
              )}
            </select>
          </label>
          <div className="chapter-plan-pair">
            {(['mustHappen', 'cannotChange', 'reveal', 'withhold', 'writingGuidance'] as const).map(
              (k) => (
                <label key={k}>
                  {t[k]}
                  <textarea
                    rows={2}
                    value={content.brief[k]}
                    onChange={(e) =>
                      change((c) => {
                        c.brief[k] = e.target.value;
                      })
                    }
                  />
                </label>
              ),
            )}
          </div>
          <p className="muted">
            {previousChapter
              ? `已引用前章定稿 v${previousChapter.version}，包含结尾与 ${previousChapter.facts.length} 条确认事实。`
              : '尚无前章定稿材料；首章可直接创作，后续章节开始正文前需先完成前章定稿。'}
          </p>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="core-save">
        <label className="outline-check">
          <input
            type="checkbox"
            checked={value.confirmed}
            disabled={disabled || saving || Boolean(error)}
            onChange={(e) => onChange({ ...value, confirmed: e.target.checked })}
          />
          {t.confirm}
        </label>
        <Button onClick={onClose} disabled={saving}>
          {t.cancel}
        </Button>
        <Button
          disabled={disabled || saving || Boolean(error)}
          disabledReason={disabled ? t.stale : error}
          onClick={() => onSave(false)}
        >
          {t.saveDraft}
        </Button>
        <Button
          variant="human"
          loading={saving}
          disabled={disabled || saving || Boolean(error) || !value.confirmed}
          disabledReason={disabled ? t.stale : error || t.confirm}
          onClick={() => onSave(true)}
        >
          {t.saveConfirmed}
        </Button>
      </div>
    </section>
  );
}
