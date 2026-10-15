import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { Badge, Button, Select } from '@/shared/ui';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import { trialApi } from '../api/backend';
import type { StoredDraft } from '../types/backend';

/** 编辑基准只在作者开始编辑/明确对照后变化，后台刷新不能替换本地文字。 */
export default function BackendDraft({ draft }: { draft: StoredDraft }) {
  const client = useQueryClient();
  const [edit, setEdit] = useState<{ id: string; text: string; draftVersion: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const versions = useQuery({
    queryKey: ['backend-versions', draft.draftVersion],
    queryFn: trialApi.versions,
    enabled: historyOpen,
  });
  const history = useQuery({
    queryKey: ['backend-version', version],
    queryFn: () => trialApi.draft(version),
    enabled: historyOpen && version > 0,
    retry: false,
  });
  const save = useMutation({
    mutationFn: trialApi.edit,
    retry: false,
    onSuccess: () => {
      setEdit(null);
      void client.invalidateQueries({ queryKey: ['backend-draft'] });
      void client.invalidateQueries({ queryKey: ['backend-trial'] });
      void client.invalidateQueries({ queryKey: ['backend-runs'] });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ['backend-draft'] });
    },
  });
  const conflicted =
    !!edit &&
    (edit.draftVersion !== draft.draftVersion ||
      (save.error instanceof ApiError && save.error.status === 409));
  const historical = version > 0 ? history.data : draft;
  return (
    <section className="page-stack">
      <h3>
        {t.storedDraft} · v{draft.draftVersion}
      </h3>
      <p>{t.storageNote}</p>
      {draft.draftVersion === 0 && <p>{t.noStoredDraft}</p>}
      {draft.segments.map((segment) => (
        <div key={segment.id}>
          <div className="backend-candidate">
            <p>{segment.text}</p>
          </div>
          <Button
            disabled={!!edit}
            disabledReason={t.cancelEdit}
            onClick={() => {
              save.reset();
              setEdit({ id: segment.id, text: segment.text, draftVersion: draft.draftVersion });
            }}
          >
            {t.editDraft}
          </Button>
        </div>
      ))}
      {edit && (
        <div className="page-stack">
          <p>{t.editNote}</p>
          <textarea
            aria-label={t.draftText}
            className="backend-draft-input"
            rows={7}
            value={edit.text}
            disabled={save.isPending}
            onChange={(e) => setEdit({ ...edit, text: e.target.value })}
          />
          <Button
            onClick={() => save.mutate(edit)}
            loading={save.isPending}
            disabled={conflicted || !edit.text.trim()}
            disabledReason={conflicted ? t.conflictDraft : t.draftText}
          >
            {t.saveDraft} · v{edit.draftVersion} → v{edit.draftVersion + 1}
          </Button>
          <Button
            onClick={() => {
              setEdit(null);
              save.reset();
            }}
            disabled={save.isPending}
            disabledReason={t.pending}
          >
            {t.cancelEdit}
          </Button>
          {save.isError && !conflicted && <p role="alert">{t.saveFailed}</p>}
          {conflicted && (
            <div className="page-stack">
              <p role="alert">{t.conflictDraft}</p>
              <h4>
                {t.latestText} · v{draft.draftVersion}
              </h4>
              <div className="backend-candidate">
                <p>{draft.segments.find((s) => s.id === edit.id)?.text}</p>
              </div>
              <Button
                variant="human"
                disabled={save.isPending || !edit.text.trim()}
                disabledReason={t.pending}
                onClick={() => save.mutate({ ...edit, draftVersion: draft.draftVersion })}
              >
                {t.rebaseSave}
              </Button>
            </div>
          )}
        </div>
      )}
      {save.isSuccess && <p role="status">{t.savedDraft}</p>}
      <details onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
        <summary>{t.versionHistory}</summary>
        {versions.isError && <Button onClick={() => void versions.refetch()}>{t.retry}</Button>}
        <Select
          aria-label={t.versionHistory}
          value={version}
          onChange={(e) => setVersion(Number(e.target.value))}
        >
          <option value={0}>{t.currentVersion}</option>
          {versions.data?.map((v) => (
            <option key={v.draftVersion} value={v.draftVersion}>
              v{v.draftVersion} · {v.origin === 'human_inline' ? t.humanOrigin : t.agentOrigin}
            </option>
          ))}
        </Select>
        {history.isFetching && <p>{t.loadDraft}</p>}
        {history.isError && <Button onClick={() => void history.refetch()}>{t.retry}</Button>}
        {historical && (
          <>
            <Badge tone={historical.origin === 'human_inline' ? 'human' : 'ai'}>
              v{historical.draftVersion}
            </Badge>
            {historical.segments.map((s) => (
              <p key={s.id}>{s.text}</p>
            ))}
          </>
        )}
      </details>
    </section>
  );
}
