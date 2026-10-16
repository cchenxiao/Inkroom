import { TechnicalDetails } from '@/shared/ui/technical-details';
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { Button, Card, Input } from '@/shared/ui';
import { publicationMessages as t } from '@/shared/lib/messages-planning-knowledge';
import {
  planningKnowledgeApi,
  publicationKey,
  type KnowledgePublishRequest,
} from '../api/planning-knowledge';
import { refreshEventQueries } from '../api/refresh-events';
import { KnowledgeFacts } from './KnowledgeSections';

export default function PlanningKnowledgePublish() {
  const project = useUIStore((s) => s.projectId),
    branch = useUIStore((s) => s.branchId);
  const enabled = project === 'project-zhuoliu' && branch === 'main';
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: publicationKey,
    queryFn: ({ signal }) => planningKnowledgeApi.preview(signal),
    enabled,
    retry: false,
  });
  const [confirmed, setConfirmed] = useState(''),
    [reason, setReason] = useState(''),
    [uncertain, setUncertain] = useState<KnowledgePublishRequest | null>(null);
  const refresh = () =>
    refreshEventQueries(client, [
      publicationKey,
      ['backend-knowledge'],
      ['planned-run-gate'],
      ['backend-trial'],
    ]);
  const publish = useMutation({
    mutationFn: planningKnowledgeApi.publish,
    retry: false,
    onSuccess: () => {
      setUncertain(null);
      setConfirmed('');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status < 500) {
        setUncertain(null);
        setConfirmed('');
      }
    },
    onSettled: () => void refresh(),
  });
  const p = query.data;
  const blocked =
    !p?.ready ||
    query.isError ||
    query.isFetching ||
    confirmed !== p?.previewDigest ||
    !reason.trim() ||
    publish.isPending ||
    !!uncertain;
  const submit = (body: KnowledgePublishRequest) => {
    setUncertain(body);
    publish.mutate(body);
  };
  if (!enabled)
    return (
      <Card>
        <p>{t.scope}</p>
      </Card>
    );
  return (
    <Card className="core-workbench" aria-label={t.title}>
      <div className="core-heading">
        <h2>{t.title}</h2>
        <Button onClick={() => void refresh()} disabled={publish.isPending}>
          {t.refresh}
        </Button>
      </div>
      <p className="text-dim">{t.note}</p>
      {query.isPending && <p role="status">{t.loading}</p>}
      {query.isError && <p role="alert">{t.error}</p>}
      {query.isSuccess && p && (
        <>
          <p>{p.reason || t.versions(p.expected.core, p.snapshot?.version ?? 0)}</p>
          {!p.current && p.replacesTeaching && <p role="note">{t.teaching}</p>}
          {p.snapshot && !p.current && (
            <details>
              <summary>
                {t.preview} · {p.snapshot.facts?.length ?? 0} 条事实
              </summary>
              <KnowledgeFacts snapshot={p.snapshot} />
            </details>
          )}
          {p.excluded.length > 0 && (
            <details>
              <summary>
                {t.excluded} · {p.excluded.length}
              </summary>
              <ul>
                {p.excluded.map((e, index) => (
                  <li key={e.id}>
                    未纳入材料 {index + 1}：{e.reason}
                    <TechnicalDetails items={{ 材料编号: e.id }} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!p.current && (
            <>
              <label>
                {t.reason}
                <Input
                  value={reason}
                  maxLength={600}
                  disabled={publish.isPending || !!uncertain}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setConfirmed('');
                  }}
                />
              </label>
              <label className="outline-check">
                <input
                  type="checkbox"
                  checked={confirmed === p.previewDigest && !!confirmed}
                  disabled={!p.ready || query.isFetching || publish.isPending || !!uncertain}
                  onChange={(e) => setConfirmed(e.target.checked ? p.previewDigest : '')}
                />
                {t.confirm}
              </label>
              <Button
                variant="human"
                disabled={blocked}
                disabledReason={p.reason || t.needConfirm}
                loading={publish.isPending}
                onClick={() =>
                  submit({
                    expected: p.expected,
                    expectedVersion: p.expectedVersion,
                    previewDigest: p.previewDigest,
                    confirm: true,
                    reason: reason.trim(),
                  })
                }
              >
                {t.publish}
              </Button>
            </>
          )}
          {p.current && (
            <Button
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('section', 'outline');
                setParams(next);
              }}
            >
              {t.outline}
            </Button>
          )}
        </>
      )}
      {publish.isSuccess && <p role="status">{t.success}</p>}
      {publish.isError && (
        <p role="alert">{publish.error instanceof ApiError ? publish.error.message : t.error}</p>
      )}
      {uncertain && !publish.isPending && (
        <div>
          <p>{t.uncertain}</p>
          <Button onClick={() => submit(uncertain)}>{t.retry}</Button>
        </div>
      )}
    </Card>
  );
}
