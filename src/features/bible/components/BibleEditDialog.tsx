import type { Dispatch, SetStateAction } from 'react';
import { Button, Modal, Input, Textarea, Field } from '@/shared/ui';
import { pages as t } from '@/shared/lib/messages-pages';
import type { BibleKind, Character, StyleProfile } from '@/types/domain';
export type Editable = Record<string, unknown>;
const textFields: Record<BibleKind, string[]> = {
  characters: ['name', 'description', 'want', 'need', 'flaw', 'arcStage'],
  rules: ['title', 'rule', 'scope'],
  timeline: ['title', 'storyTime', 'summary', 'chapterId'],
  foreshadows: ['title', 'payload', 'planResolveChapter'],
  info: ['fact', 'source', 'disclosedChapter'],
  style: ['anchorText', 'pov', 'tense', 'tone', 'bannedWords'],
};
const fieldLabels: Record<string, string> = {
  name: t.bible.newName,
  title: t.bible.newName,
  description: t.bible.descriptionLabel,
  want: t.bible.want,
  need: t.bible.need,
  flaw: t.bible.flaw,
  arcStage: t.bible.arc,
  rule: t.bible.ruleText,
  scope: t.bible.scope,
  storyTime: t.bible.storyTime,
  summary: t.bible.summary,
  chapterId: t.common.chapter,
  payload: t.bible.payload,
  planResolveChapter: t.bible.resolve,
  fact: t.bible.fact,
  source: t.bible.source,
  disclosedChapter: t.common.chapter,
  anchorText: t.bible.anchor,
  pov: t.bible.pov,
  tense: t.bible.tense,
  tone: t.bible.tone,
  bannedWords: t.bible.banned,
};

export default function BibleEditDialog({
  editing,
  setEditing,
  kind,
  reason,
  setReason,
  pending,
  error,
  version,
  stale,
  onPreview,
}: {
  editing: Editable | null;
  setEditing: Dispatch<SetStateAction<Editable | null>>;
  kind: BibleKind;
  reason: string;
  setReason: (v: string) => void;
  pending: boolean;
  error: Error | null;
  version: number;
  stale: boolean;
  onPreview: () => Promise<void>;
}) {
  return (
    <Modal
      open={!!editing}
      onOpenChange={(open) => {
        if (!open) setEditing(null);
      }}
      title={`${t.bible.editTitle} · ${t.bible.tabs[kind]}`}
      description={t.common.note}
      footer={
        <>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={pending || !reason.trim() || !version || stale}
            disabledReason={stale ? t.common.stale : t.common.required}
            onClick={() => void onPreview().catch(() => undefined)}
          >
            {t.common.preview}
          </Button>
        </>
      }
    >
      {editing && (
        <div className="page-form">
          {textFields[kind].map((field) => (
            <Field key={field} label={fieldLabels[field] ?? field}>
              <Textarea
                value={
                  Array.isArray(editing[field])
                    ? (editing[field] as string[]).join('、')
                    : String(editing[field] ?? '')
                }
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    [field]:
                      field === 'bannedWords'
                        ? e.target.value.split(/[、,，]/).filter(Boolean)
                        : e.target.value,
                  })
                }
                rows={field === 'description' || field === 'anchorText' ? 4 : 2}
              />
            </Field>
          ))}
          {kind === 'characters' && Boolean(editing.voice) && (
            <>
              <Field label={t.bible.register}>
                <Input
                  value={(editing.voice as Character['voice']).register}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      voice: {
                        ...(editing.voice as Character['voice']),
                        register: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label={t.bible.sentenceStyle}>
                <Input
                  value={(editing.voice as Character['voice']).sentenceStyle}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      voice: {
                        ...(editing.voice as Character['voice']),
                        sentenceStyle: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            </>
          )}
          {kind === 'characters' && editing.hardTraits != null && (
            <>
              {Object.entries(editing.hardTraits as Record<string, string>).map(([key, value]) => (
                <Field key={key} label={`${t.bible.traits} · ${key}`}>
                  <Input
                    value={value}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        hardTraits: {
                          ...(editing.hardTraits as Record<string, string>),
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
              ))}
            </>
          )}
          {kind === 'style' && editing.statisticalTargets != null && (
            <>
              <Field label={t.bible.sentenceLength}>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={
                    (editing.statisticalTargets as StyleProfile['statisticalTargets'])
                      .sentenceLength
                  }
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      statisticalTargets: {
                        ...(editing.statisticalTargets as StyleProfile['statisticalTargets']),
                        sentenceLength: Math.max(1, Number(e.target.value)),
                      },
                    })
                  }
                />
              </Field>
              <Field label={`${t.bible.dialogueRatio} (%)`}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(
                    (editing.statisticalTargets as StyleProfile['statisticalTargets'])
                      .dialogueRatio * 100,
                  )}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      statisticalTargets: {
                        ...(editing.statisticalTargets as StyleProfile['statisticalTargets']),
                        dialogueRatio: Math.min(100, Math.max(0, Number(e.target.value))) / 100,
                      },
                    })
                  }
                />
              </Field>
              <Field label={t.bible.rhythm}>
                <Input
                  value={(
                    editing.statisticalTargets as StyleProfile['statisticalTargets']
                  ).rhythm.join('、')}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      statisticalTargets: {
                        ...(editing.statisticalTargets as StyleProfile['statisticalTargets']),
                        rhythm: e.target.value
                          .split(/[、,，]/)
                          .filter(Boolean)
                          .map(Number)
                          .filter(Number.isFinite),
                      },
                    })
                  }
                />
              </Field>
            </>
          )}
          <Field label={t.common.reason}>
            <Textarea
              placeholder={t.bible.reasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error && (
            <p className="page-error" role="alert">
              {error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
