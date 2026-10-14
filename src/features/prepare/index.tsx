import BackendTrial from './components/BackendTrial';
import SuggestionDialog from './components/SuggestionDialog';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Feather, LockKeyhole, Upload, ChevronRight, Sparkles } from 'lucide-react';
import { useAction, useBible, useChapter, useProject, useTree } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import { zh } from '@/shared/lib/messages';
import {
  Button,
  Badge,
  Card,
  Modal,
  AsyncState,
  Input,
  Textarea,
  Select,
  PageHeader,
  Field,
} from '@/shared/ui';
import type { ChangeSet, Project } from '@/types/domain';
import './prepare.css';
export default function PreparePage() {
  const project = useProject();
  const bible = useBible();
  const tree = useTree();
  const chapter = useChapter();
  const navigate = useNavigate();
  const branchId = useUIStore((s) => s.branchId);
  const stale = useUIStore((s) => s.stale);
  const [form, setForm] = useState<Partial<Project>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [importKind, setImportKind] = useState('bible');
  const [importText, setImportText] = useState('');
  const [edit, setEdit] = useState<{
    kind: string;
    id: string;
    value: Record<string, unknown>;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ChangeSet | null>(null);
  const save = useAction<Project, unknown>('/projects/project-zhuoliu', 'patch');
  const imports = useAction<{ imported: number; message: string }, unknown>('/imports');
  const previewAction = useAction<ChangeSet, unknown>('/changesets/preview');
  const apply = useAction<ChangeSet, unknown>(`/changesets/${preview?.id ?? ''}/apply`);
  const value = { ...project.data, ...form } as Project;
  const version = chapter.data?.chapter.draftVersion ?? 0;
  async function saveProject() {
    await save.mutateAsync({ ...form, draftVersion: version, branchId });
    setForm({});
  }
  async function previewEdit() {
    if (!edit) return;
    setPreview(
      await previewAction.mutateAsync({
        origin: 'human_bible',
        targetType: edit.kind,
        targetId: edit.id,
        new: edit.value,
        reason,
        draftVersion: version,
        branchId,
      }),
    );
    setEdit(null);
  }
  return (
    <main className="page-content prepare-page">
      <PageHeader
        eyebrow={t.prepare.eyebrow}
        title={t.prepare.title}
        description={t.prepare.description}
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              {t.common.import}
            </Button>
            <Button variant="human" disabled={!version} onClick={() => setSuggestOpen(true)}>
              <Sparkles size={15} />
              {t.common.suggestion}
            </Button>
          </>
        }
      />
      <AsyncState
        loading={project.isLoading || bible.isLoading || tree.isLoading}
        error={project.error ?? bible.error ?? tree.error}
        onRetry={() => {
          void project.refetch().catch(() => undefined);
          void bible.refetch().catch(() => undefined);
          void tree.refetch().catch(() => undefined);
        }}
        empty={!project.data}
      >
        {project.data && (
          <>
            <div className="prepare-grid">
              <Card className="project-brief">
                <div className="section-title">
                  <Feather size={17} />
                  <h2>{t.prepare.premise}</h2>
                  {value.locked && (
                    <Badge tone="human">
                      <LockKeyhole size={11} />
                      {t.common.locked}
                    </Badge>
                  )}
                </div>
                <div className="page-form">
                  <Field label={t.prepare.name}>
                    <Input
                      value={value.name}
                      disabled={value.locked}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label={t.prepare.logline}>
                    <Textarea
                      rows={3}
                      value={value.logline}
                      disabled={value.locked}
                      onChange={(e) => setForm({ ...form, logline: e.target.value })}
                    />
                  </Field>
                  <Field label={t.prepare.conflict}>
                    <Textarea
                      rows={3}
                      value={value.coreConflict}
                      disabled={value.locked}
                      onChange={(e) => setForm({ ...form, coreConflict: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="page-actions">
                  <Button
                    disabled={save.isPending || value.locked || !Object.keys(form).length}
                    disabledReason={value.locked ? t.common.readOnly : t.common.noChanges}
                    onClick={() => void saveProject().catch(() => undefined)}
                  >
                    {t.prepare.saveProject}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={save.isPending}
                    onClick={() =>
                      void save
                        .mutateAsync({
                          locked: !value.locked,
                          draftVersion: version,
                          branchId,
                        })
                        .catch(() => undefined)
                    }
                  >
                    {value.locked ? t.common.unlock : t.common.lock}
                  </Button>
                </div>
                {save.error && (
                  <p role="alert" className="page-error">
                    {save.error.message}
                  </p>
                )}
              </Card>
              <Card className="project-settings">
                <div className="section-title">
                  <h2>{t.prepare.project}</h2>
                </div>
                <div className="page-form">
                  {(['genre', 'tone', 'pov', 'tense'] as const).map((key) => (
                    <Field label={t.prepare[key]} key={key}>
                      <Input
                        value={value[key]}
                        disabled={value.locked}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                    </Field>
                  ))}
                  <Field label={t.prepare.words}>
                    <Input
                      type="number"
                      min={1000}
                      step={1000}
                      value={value.targetWords}
                      disabled={value.locked}
                      onChange={(e) => setForm({ ...form, targetWords: Number(e.target.value) })}
                    />
                  </Field>
                </div>
              </Card>
            </div>
            {bible.data && (
              <section className="page-section">
                <div className="section-title">
                  <h2>{t.prepare.bible}</h2>
                  <small>{t.common.note}</small>
                </div>
                <div className="prepare-cast">
                  {bible.data.characters.map((c) => (
                    <Card key={c.id}>
                      <div className="page-row">
                        <div className="character-identity">
                          <div className="character-avatar">{c.name.slice(-1)}</div>
                          <div>
                            <h3>{c.name}</h3>
                            <small>{c.role}</small>
                          </div>
                        </div>
                        {c.locked && <LockKeyhole size={14} />}
                      </div>
                      <p>{c.description}</p>
                      <dl className="character-motivations">
                        <div>
                          <dt>{t.bible.want}</dt>
                          <dd>{c.want}</dd>
                        </div>
                        <div>
                          <dt>{t.bible.need}</dt>
                          <dd>{c.need}</dd>
                        </div>
                        <div>
                          <dt>{t.bible.flaw}</dt>
                          <dd>{c.flaw}</dd>
                        </div>
                      </dl>
                      <div className="page-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={c.locked}
                          disabledReason={t.common.readOnly}
                          onClick={() => {
                            setEdit({ kind: 'characters', id: c.id, value: { ...c } });
                            setReason('');
                          }}
                        >
                          {t.common.edit}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={previewAction.isPending}
                          onClick={() =>
                            void previewAction
                              .mutateAsync({
                                origin: 'human_bible',
                                targetType: 'characters',
                                targetId: c.id,
                                new: { ...c, locked: !c.locked },
                                reason: c.locked ? t.common.unlock : t.common.lock,
                                draftVersion: version,
                                branchId,
                              })
                              .then(setPreview)
                              .catch(() => undefined)
                          }
                        >
                          {c.locked ? t.common.unlock : t.common.lock}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
                <div className="prepare-grid">
                  <Card>
                    <h3>{t.bible.tabs.style}</h3>
                    <blockquote className="style-anchor">{bible.data.style.anchorText}</blockquote>
                    <div className="voice-tags">
                      {[bible.data.style.tone, bible.data.style.pov, bible.data.style.tense].map(
                        (tag) => (
                          <Badge key={tag} tone="ai">
                            {tag}
                          </Badge>
                        ),
                      )}
                    </div>
                    <div className="metric-pair">
                      <div>
                        <strong>{bible.data.style.statisticalTargets.sentenceLength}</strong>
                        <small>{t.bible.sentenceLength}</small>
                      </div>
                      <div>
                        <strong>
                          {Math.round(bible.data.style.statisticalTargets.dialogueRatio * 100)}%
                        </strong>
                        <small>{t.bible.dialogueRatio}</small>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={bible.data.style.locked}
                      disabledReason={t.common.readOnly}
                      onClick={() => {
                        setEdit({
                          kind: 'style',
                          id: bible.data!.style.id,
                          value: { ...bible.data!.style },
                        });
                        setReason('');
                      }}
                    >
                      {t.common.edit}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={previewAction.isPending || stale}
                      onClick={() =>
                        void previewAction
                          .mutateAsync({
                            origin: 'human_bible',
                            targetType: 'style',
                            targetId: bible.data!.style.id,
                            new: { ...bible.data!.style, locked: !bible.data!.style.locked },
                            reason: bible.data!.style.locked ? t.common.unlock : t.common.lock,
                            draftVersion: version,
                            branchId,
                          })
                          .then(setPreview)
                          .catch(() => undefined)
                      }
                    >
                      {bible.data.style.locked ? t.common.unlock : t.common.lock}
                    </Button>
                  </Card>
                  <Card>
                    <h3>{t.bible.tabs.rules}</h3>
                    {bible.data.rules.map((rule) => (
                      <div className="prepare-rule" key={rule.id}>
                        <div className="page-row">
                          <strong>{rule.title}</strong>
                          <Badge tone={rule.rigidity === 'hard' ? 'human' : 'muted'}>
                            {rule.rigidity === 'hard' ? t.bible.hard : t.bible.soft}
                          </Badge>
                        </div>
                        <p>{rule.rule}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={rule.locked}
                          disabledReason={t.common.readOnly}
                          onClick={() => {
                            setEdit({ kind: 'rules', id: rule.id, value: { ...rule } });
                            setReason('');
                          }}
                        >
                          {t.common.edit}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={previewAction.isPending}
                          onClick={() =>
                            void previewAction
                              .mutateAsync({
                                origin: 'human_bible',
                                targetType: 'rules',
                                targetId: rule.id,
                                new: { ...rule, locked: !rule.locked },
                                reason: rule.locked ? t.common.unlock : t.common.lock,
                                draftVersion: version,
                                branchId,
                              })
                              .then(setPreview)
                              .catch(() => undefined)
                          }
                        >
                          {rule.locked ? t.common.unlock : t.common.lock}
                        </Button>
                      </div>
                    ))}
                  </Card>
                </div>
              </section>
            )}
            <section className="page-section">
              <div className="section-title">
                <h2>{t.prepare.outline}</h2>
                <small>{t.prepare.outlineDescription}</small>
              </div>
              <div className="outline-list">
                {tree.data?.map((ch) => (
                  <Card key={ch.id} className="outline-card">
                    <div className="page-row">
                      <div>
                        <small className="page-eyebrow">
                          CHAPTER {String(ch.number).padStart(2, '0')}
                        </small>
                        <h3>{ch.title}</h3>
                      </div>
                      <Badge
                        tone={
                          ch.status === 'finalized'
                            ? 'success'
                            : ch.status === 'human'
                              ? 'human'
                              : 'muted'
                        }
                      >
                        {zh.status[ch.status]}
                      </Badge>
                    </div>
                    {ch.scenes.map((scene) => (
                      <details key={scene.id}>
                        <summary>
                          {scene.title}
                          <ChevronRight size={13} />
                        </summary>
                        {scene.beats.map((beat) => (
                          <div className="beat-row" key={beat.id}>
                            <span>{String(beat.order).padStart(2, '0')}</span>
                            <div>
                              <strong>{beat.title}</strong>
                              <p>{beat.description}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEdit({ kind: 'beats', id: beat.id, value: { ...beat } });
                                setReason('');
                              }}
                            >
                              {t.common.edit}
                            </Button>
                          </div>
                        ))}
                      </details>
                    ))}
                    <div className="page-row">
                      <small>
                        {ch.wordCount.toLocaleString()} / {ch.targetWords.toLocaleString()}{' '}
                        {t.reports.wordsUnit}
                      </small>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          useUIStore.getState().setChapter(ch.id);
                          navigate('/workspace');
                        }}
                      >
                        {t.prepare.start}
                        <ArrowRight size={14} />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          </>
        )}
      </AsyncState>
      <BackendTrial />
      <SuggestionDialog
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        version={version}
        stale={stale}
        onPreview={setPreview}
      />
      <Modal
        open={importOpen}
        onOpenChange={setImportOpen}
        title={t.common.import}
        footer={
          <Button
            disabled={!importText.trim() || imports.isPending || !version}
            onClick={() =>
              void imports
                .mutateAsync({
                  kind: importKind,
                  text: importText,
                  draftVersion: version,
                  branchId,
                })
                .then(() => {
                  setImportOpen(false);
                  setImportText('');
                })
                .catch(() => undefined)
            }
          >
            {t.common.import}
          </Button>
        }
      >
        <div className="page-form">
          <Field label={t.prepare.importKind}>
            <Select value={importKind} onChange={(e) => setImportKind(e.target.value)}>
              {Object.entries(t.prepare.importKinds).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.prepare.importText}>
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={10}
            />
          </Field>
          {imports.error && (
            <p role="alert" className="page-error">
              {imports.error.message}
            </p>
          )}
        </div>
      </Modal>
      <Modal
        open={!!edit}
        onOpenChange={(open) => {
          if (!open) setEdit(null);
        }}
        title={t.bible.editTitle}
        description={t.common.note}
        footer={
          <Button
            disabled={!reason.trim() || previewAction.isPending || stale}
            onClick={() => void previewEdit().catch(() => undefined)}
          >
            {t.common.preview}
          </Button>
        }
      >
        {edit && (
          <div className="page-form">
            {Object.entries(edit.value)
              .filter(([key, val]) => typeof val === 'string' && !['id', 'sceneId'].includes(key))
              .map(([key, val]) => (
                <Field
                  key={key}
                  label={
                    (
                      {
                        name: t.bible.newName,
                        title: t.bible.newName,
                        description: t.bible.descriptionLabel,
                        want: t.bible.want,
                        need: t.bible.need,
                        flaw: t.bible.flaw,
                        rule: t.bible.ruleText,
                        scope: t.bible.scope,
                        anchorText: t.bible.anchor,
                        pov: t.bible.pov,
                        tense: t.bible.tense,
                        tone: t.bible.tone,
                        role: t.bible.tabs.characters,
                        arcStage: t.bible.arc,
                      } as Record<string, string>
                    )[key] ?? key
                  }
                >
                  <Textarea
                    value={String(val)}
                    onChange={(e) =>
                      setEdit({ ...edit, value: { ...edit.value, [key]: e.target.value } })
                    }
                  />
                </Field>
              ))}
            <Field label={t.common.reason}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {previewAction.error && (
              <p role="alert" className="page-error">
                {previewAction.error.message}
              </p>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={t.bible.previewTitle}
        footer={
          <Button
            variant="human"
            disabled={apply.isPending || stale}
            onClick={() =>
              void apply
                .mutateAsync({
                  strategy: 'mark_only',
                  draftVersion: preview?.draftVersion,
                  branchId,
                })
                .then(() => setPreview(null))
                .catch(() => undefined)
            }
          >
            {t.bible.mark}
          </Button>
        }
      >
        {preview && (
          <div className="page-stack">
            <div className="page-diff">
              <div>
                <small>{t.common.before}</small>
                <pre>{JSON.stringify(preview.old, null, 2)}</pre>
              </div>
              <div>
                <small>{t.common.after}</small>
                <pre>{JSON.stringify(preview.new, null, 2)}</pre>
              </div>
            </div>
            {preview.blastRadius.map((ref) => (
              <div className="impact-row" key={ref.id}>
                <Badge tone="warning">{t.changes[ref.level]}</Badge>
                <div>
                  <strong>{ref.label}</strong>
                  <p>{ref.reason}</p>
                </div>
              </div>
            ))}
            {!preview.blastRadius.length && <p>{t.bible.noImpact}</p>}
            {apply.error && (
              <p role="alert" className="page-error">
                {apply.error.message}
              </p>
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}
