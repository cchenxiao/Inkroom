import MergeDialog from './components/MergeDialog';
import { useState } from 'react';
import { GitBranch, History, Plus, RotateCcw, Check } from 'lucide-react';
import { useAction, useBranches, useChapter, useResource } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import { Button, Badge, Card, Modal, AsyncState, Input, PageHeader, Field } from '@/shared/ui';
import type { Branch, Commit } from '@/types/domain';
import './versions.css';
export default function VersionsPage() {
  const branchId = useUIStore((s) => s.branchId);
  const stale = useUIStore((s) => s.stale);
  const chapterId = useUIStore((s) => s.chapterId);
  const branches = useBranches();
  const commits = useResource<Commit[]>(`/commits?branchId=${branchId}&chapterId=${chapterId}`);
  const chapter = useChapter();
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [restore, setRestore] = useState<Commit | null>(null);
  const [abandon, setAbandon] = useState<Branch | null>(null);
  const [mergeBranch, setMergeBranch] = useState<Branch | null>(null);
  const create = useAction<Branch, unknown>('/branches');
  const restoreAction = useAction<Commit, unknown>(`/commits/${restore?.id ?? ''}/restore`);
  const abandonAction = useAction(`/branches/${abandon?.id ?? ''}`, 'delete');
  const version = chapter.data?.chapter.draftVersion ?? 0;
  const activeCommit = commits.data?.find((c) => c.id === selected) ?? commits.data?.[0];
  return (
    <main className="page-content versions-page">
      <PageHeader
        eyebrow={t.versions.eyebrow}
        title={t.versions.title}
        description={t.versions.description}
        actions={
          <Button variant="human" onClick={() => setCreateOpen(true)}>
            <Plus size={15} />
            {t.versions.create}
          </Button>
        }
      />
      <AsyncState
        loading={branches.isLoading}
        error={branches.error}
        onRetry={() => branches.refetch()}
        empty={!branches.data?.length}
      >
        <div className="branch-grid">
          {branches.data?.map((branch) => (
            <Card
              key={branch.id}
              className={`branch-card ${branch.id === branchId ? 'current' : ''}`}
            >
              <div className="page-row">
                <GitBranch size={18} />
                <Badge tone={branch.isMain ? 'ai' : branch.id === branchId ? 'human' : 'muted'}>
                  {branch.isMain
                    ? t.versions.main
                    : branch.status === 'merged'
                      ? t.versions.merged
                      : branch.status === 'abandoned'
                        ? t.versions.abandoned
                        : branch.id === branchId
                          ? t.versions.current
                          : t.versions.branches}
                </Badge>
              </div>
              <h3>{branch.name}</h3>
              <p>{branch.description}</p>
              <small>{new Date(branch.createdAt).toLocaleDateString('zh-CN')}</small>
              <div className="page-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={branch.id === branchId || branch.status === 'abandoned'}
                  onClick={() => {
                    useUIStore.getState().setBranch(branch.id);
                    setSelected(null);
                  }}
                >
                  {branch.id === branchId ? (
                    <>
                      <Check size={13} />
                      {t.versions.current}
                    </>
                  ) : (
                    t.versions.switch
                  )}
                </Button>
                {!branch.isMain && branch.status === 'active' && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMergeBranch(branch);
                      }}
                    >
                      {t.versions.merge}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAbandon(branch)}>
                      {t.versions.abandon}
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      </AsyncState>
      <section className="page-section">
        <div className="section-title">
          <History size={17} />
          <h2>{t.versions.timeline}</h2>
        </div>
        <AsyncState
          loading={commits.isLoading}
          error={commits.error}
          onRetry={() => commits.refetch()}
          empty={!commits.data?.length}
        >
          <div className="version-layout">
            <div className="commit-timeline">
              {commits.data?.map((commit) => (
                <button
                  className={`commit-item ${activeCommit?.id === commit.id ? 'selected' : ''}`}
                  key={commit.id}
                  onClick={() => setSelected(commit.id)}
                >
                  <div className="commit-dot" />
                  <div className="page-row">
                    <Badge tone={commit.author === 'human' ? 'human' : 'ai'}>
                      v{commit.draftVersion}
                    </Badge>
                    <small>
                      {new Date(commit.createdAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </div>
                  <h3>{commit.title}</h3>
                  <p>{commit.summary}</p>
                  <small>
                    {commit.author === 'human' ? t.versions.human : t.versions.agent} · {commit.id}
                  </small>
                </button>
              ))}
            </div>
            {activeCommit && (
              <Card className="commit-detail">
                <div className="page-row">
                  <div>
                    <small className="page-eyebrow">{t.versions.compare}</small>
                    <h2>{activeCommit.title}</h2>
                  </div>
                  <Button
                    size="sm"
                    variant="human"
                    disabled={stale || !version}
                    disabledReason={t.common.stale}
                    onClick={() => setRestore(activeCommit)}
                  >
                    <RotateCcw size={13} />
                    {t.versions.restore}
                  </Button>
                </div>
                <p className="quiet">{activeCommit.summary}</p>
                <div className="version-diff">
                  <div>
                    <small>{t.common.before}</small>
                    <p className="diff-old">{activeCommit.oldText || '—'}</p>
                  </div>
                  <div>
                    <small>{t.common.after}</small>
                    <p className="diff-new">{activeCommit.newText || '—'}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </AsyncState>
      </section>
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t.versions.create}
        description={t.versions.createHint}
        footer={
          <Button
            variant="human"
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              void create
                .mutateAsync({ name: name.trim(), fromBranchId: branchId })
                .then((branch) => {
                  setCreateOpen(false);
                  setName('');
                  useUIStore.getState().setBranch(branch.id);
                })
                .catch(() => undefined)
            }
          >
            {t.versions.create}
          </Button>
        }
      >
        <Field label={t.versions.name}>
          <Input
            autoFocus
            placeholder={t.versions.nameHint}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {create.error && (
          <p role="alert" className="page-error">
            {create.error.message}
          </p>
        )}
      </Modal>
      <Modal
        open={!!restore}
        onOpenChange={(open) => {
          if (!open) setRestore(null);
        }}
        title={t.versions.restoreTitle}
        description={t.versions.restoreDescription}
        footer={
          <Button
            variant="human"
            disabled={stale || restoreAction.isPending}
            onClick={() =>
              void restoreAction
                .mutateAsync({ draftVersion: version, branchId })
                .then(() => setRestore(null))
                .catch(() => undefined)
            }
          >
            {t.versions.confirmRestore}
          </Button>
        }
      >
        <h3>{restore?.title}</h3>
        <p>{restore?.summary}</p>
        <small>{t.versions.history}</small>
        {restoreAction.error && (
          <p role="alert" className="page-error">
            {restoreAction.error.message}
          </p>
        )}
      </Modal>
      <Modal
        open={!!abandon}
        onOpenChange={(open) => {
          if (!open) setAbandon(null);
        }}
        title={t.versions.abandonTitle}
        description={t.versions.abandonDescription}
        footer={
          <Button
            variant="danger"
            disabled={abandonAction.isPending}
            onClick={() =>
              void abandonAction
                .mutateAsync({})
                .then(() => {
                  if (abandon?.id === branchId) useUIStore.getState().setBranch('main');
                  setAbandon(null);
                })
                .catch(() => undefined)
            }
          >
            {t.versions.abandon}
          </Button>
        }
      >
        <h3>{abandon?.name}</h3>
        <p>{abandon?.description}</p>
        {abandonAction.error && (
          <p role="alert" className="page-error">
            {abandonAction.error.message}
          </p>
        )}
      </Modal>
      {mergeBranch && (
        <MergeDialog
          key={mergeBranch.id}
          branch={mergeBranch}
          onClose={() => setMergeBranch(null)}
        />
      )}
    </main>
  );
}
