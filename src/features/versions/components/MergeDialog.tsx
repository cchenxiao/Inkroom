import { useEffect, useState } from 'react';
import { GitMerge, Check } from 'lucide-react';
import { Button, Badge, Card, Modal, AsyncState, Select, Field } from '@/shared/ui';
import { useAction, useResource } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import type { Branch, Commit, ConflictChoice, MergePreview, ChapterDocument } from '@/types/domain';
export default function MergeDialog({
  branch: mergeBranch,
  onClose,
}: {
  branch: Branch;
  onClose: () => void;
}) {
  const stale = useUIStore((s) => s.stale);
  const chapterId = useUIStore((s) => s.chapterId);
  const [resolutions, setResolutions] = useState<Record<string, ConflictChoice>>({});
  const merge = useResource<MergePreview>(`/branches/${mergeBranch.id}/merge`);
  const mainDocument = useResource<ChapterDocument>(`/chapters/${chapterId}?branchId=main`);
  const previewRevision = JSON.stringify([merge.data?.targetVersions, merge.data?.sourceVersions]);
  useEffect(() => {
    setResolutions({});
  }, [previewRevision]);
  const mergeAction = useAction<Commit, unknown>(`/branches/${mergeBranch.id}/merge`);
  const unresolved = merge.data?.conflicts.filter((c) => !resolutions[c.id]) ?? [];
  return (
    <Modal
      open={!!mergeBranch}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.versions.mergeTitle}
      description={t.versions.mergeDescription}
      footer={
        <Button
          variant="human"
          disabled={
            !merge.data ||
            !mainDocument.data ||
            unresolved.length > 0 ||
            mergeAction.isPending ||
            stale
          }
          disabledReason={unresolved.length ? t.versions.choose : t.common.stale}
          onClick={() =>
            void mergeAction
              .mutateAsync({
                draftVersion: mainDocument.data?.chapter.draftVersion,
                resolutions,
                targetVersions: merge.data?.targetVersions,
                sourceVersions: merge.data?.sourceVersions,
              })
              .then(() => {
                onClose();
                useUIStore.getState().setBranch('main');
              })
              .catch(() => undefined)
          }
        >
          <GitMerge size={14} />
          {t.versions.mergeConfirm}
        </Button>
      }
    >
      <AsyncState loading={merge.isLoading} error={merge.error} onRetry={() => merge.refetch()}>
        {merge.data && (
          <div className="page-stack">
            <div className="page-row">
              <h3>
                {mergeBranch?.name} → {t.versions.main}
              </h3>
              <Badge>{merge.data.commits.length}</Badge>
            </div>
            {merge.data.commits.map((commit) => (
              <p key={commit.id}>
                {commit.title} · v{commit.draftVersion}
              </p>
            ))}
            {!merge.data.conflicts.length && (
              <p>
                <Check size={14} />
                {t.versions.noConflict}
              </p>
            )}
            {merge.data.conflicts.map((conflict) => (
              <Card key={conflict.id}>
                <h3>{conflict.title}</h3>
                <div className="evidence-pair">
                  <div>
                    <small>{t.changes.bible}</small>
                    <p>{conflict.bibleSays}</p>
                  </div>
                  <div>
                    <small>{t.changes.manuscript}</small>
                    <p>{conflict.manuscriptSays}</p>
                  </div>
                </div>
                <p className="quiet">{conflict.witnessRefs.join(' · ')}</p>
                <Field label={t.changes.choice}>
                  <Select
                    value={resolutions[conflict.id] ?? ''}
                    onChange={(e) =>
                      setResolutions({
                        ...resolutions,
                        [conflict.id]: e.target.value as ConflictChoice,
                      })
                    }
                  >
                    <option value="">{t.versions.choose}</option>
                    {conflict.options.map((choice) => (
                      <option key={choice} value={choice}>
                        {t.changes.choices[choice]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Card>
            ))}
            {mergeAction.error && (
              <p role="alert" className="page-error">
                {mergeAction.error.message}
              </p>
            )}
          </div>
        )}
      </AsyncState>
    </Modal>
  );
}
