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
        <p>{t.legacyContext}</p>
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
                {query.data.assemblerVersion} · {t.contextBudget} {query.data.tokenEstimate} /{' '}
                {query.data.budget} · {t.outputReserve} {query.data.reservedOutputTokens}
              </p>
              <p>
                {t.contextBase} v{query.data.baseDraftVersion} ·{' '}
                <span className="mono" title={query.data.digest}>
                  {query.data.digest.slice(0, 16)}
                </span>
              </p>
              {query.data.sources.map((source) => (
                <details key={`${source.kind}:${source.id}`}>
                  <summary>
                    {t.sourceKinds[source.kind] ?? source.kind} · {source.title}{' '}
                    <Badge>
                      v{source.version} · {t.directSource}
                    </Badge>
                  </summary>
                  <p className="backend-source-text">{source.excerpt}</p>
                  <small className="mono">
                    {source.id} · {source.digest.slice(0, 16)}
                  </small>
                </details>
              ))}
              <h4>{t.contextExcluded}</h4>
              {query.data.excluded.map((source) => (
                <p key={source.title}>
                  {source.title}：{source.reason}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </details>
  );
}
