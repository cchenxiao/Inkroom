import { useResource } from '@/shared/api/hooks';
import { AsyncState, Badge } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
import type { ContextManifest } from '@/types/domain';
export function ContextManifestPanel({ runId }: { runId: string }) {
  const q = useResource<ContextManifest>(`/runs/${runId}/context-manifest`);
  return (
    <section className="manifest-panel">
      <h3>{t.context}</h3>
      <AsyncState loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && (
          <>
            <p className="mono muted">
              {q.data.tokenEstimate.toLocaleString()} / {q.data.budget.toLocaleString()} tokens
            </p>
            {q.data.sources.map((s) => (
              <details key={s.id}>
                <summary>
                  {s.title}
                  <Badge>
                    v{s.version} · {s.method}
                  </Badge>
                </summary>
                <p>{s.excerpt}</p>
                <small>{s.tokens} tokens</small>
              </details>
            ))}
            <h4>{t.excluded}</h4>
            {q.data.excluded.map((s) => (
              <p className="muted" key={s.title}>
                {s.title} — {s.reason}
              </p>
            ))}
          </>
        )}
      </AsyncState>
    </section>
  );
}
