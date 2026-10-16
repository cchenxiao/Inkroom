import { TechnicalDetails } from '@/shared/ui/technical-details';
import { textLabel } from '@/shared/lib/business-labels';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@/shared/ui';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import { trialApi } from '../api/backend';
import type { BackendRun } from '../types/backend';

export default function BackendContextManifest({ run }: { run: BackendRun }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['backend-context', run.id],
    queryFn: ({ signal }) => trialApi.manifest(run.id, signal),
    enabled: open && !!run.inputDigest,
    retry: false,
    staleTime: Infinity,
  });
  return (
    <details className="backend-manifest" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t.contextManifest}</summary>
      {!run.inputDigest ? (
        <p>
          {run.currentNode === 'context_assemble'
            ? run.status === 'running'
              ? t.preparingContext
              : t.preparationStopped
            : t.legacyContext}
        </p>
      ) : (
        <>
          {query.isPending && <p>{t.loadDraft}</p>}
          {query.isError && (
            <p role="alert">
              {t.contextError} <Button onClick={() => void query.refetch()}>{t.retry}</Button>
            </p>
          )}
          {query.data && (
            <div className="page-stack">
              <p>{t.contextNote}</p>
              <p>
                {t.contextBudget} {query.data.tokenEstimate} / {query.data.budget} ·{' '}
                {t.outputReserve} {query.data.reservedOutputTokens}
              </p>
              <p>
                {t.contextBase} v{query.data.baseDraftVersion}
              </p>
              <TechnicalDetails
                items={{
                  材料校验值: query.data.digest,
                  材料整理器版本: query.data.assemblerVersion,
                }}
              />
              {query.data.sources.map((source) => (
                <details key={`${source.kind}:${source.id}`}>
                  <summary>
                    {t.sourceKinds[source.kind] ?? '创作材料'} ·{' '}
                    {textLabel(source.title, '未命名材料')}{' '}
                    <Badge>
                      v{source.version} · {t.retrievalMethods[source.method] ?? '其他检索方式'}
                    </Badge>
                  </summary>
                  <p className="backend-source-text">{source.excerpt}</p>
                  <TechnicalDetails items={{ 材料编号: source.id, 校验值: source.digest }} />
                </details>
              ))}
              <h4>{t.contextExcluded}</h4>
              {query.data.excluded.map((source) => (
                <p key={textLabel(source.title, '未命名材料')}>
                  {textLabel(source.title, '未命名材料')}：{source.reason}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </details>
  );
}
