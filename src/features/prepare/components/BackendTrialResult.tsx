import { Badge } from '@/shared/ui';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import type { BackendRun } from '../types/backend';

/** 只读展示候选与逐轮 patch，不把试运行内容写回工作台。 */
export default function BackendTrialResult({
  result,
}: {
  result: NonNullable<BackendRun['result']>;
}) {
  const reviews = result.reviews ?? [];
  const reviewed = reviews.some((r) => r.draftVersion === result.draftVersion);
  const findings = result.report.findings ?? [];
  return (
    <>
      <h3>{t.candidate}</h3>
      <div className="backend-candidate">
        {result.segments.map((s) => (
          <p key={s.id}>{s.text}</p>
        ))}
      </div>
      <h3>{t.findings}</h3>
      {!reviewed && <p>{t.reviewPending}</p>}
      {reviewed && findings.length === 0 && <p>{t.noFindings}</p>}
      {reviewed &&
        findings.map((f) => (
          <div key={f.id} className="page-stack">
            <Badge tone="info">{f.severity}</Badge>
            <blockquote>{f.quote}</blockquote>
            <p>{f.reason}</p>
            <p>{f.suggestion}</p>
          </div>
        ))}
      <details open>
        <summary>{t.history}</summary>
        {(result.revisions ?? []).length === 0 && <p>{t.noRevision}</p>}
        {(result.revisions ?? []).map((r) => (
          <section key={r.round} className="backend-revision">
            <h4>
              {t.progress} {r.round} · v{r.fromVersion} → v{r.toVersion}
            </h4>
            {r.patches.map((p) => (
              <div key={p.findingId}>
                <div className="backend-inline-diff">
                  <del>{p.oldText}</del>
                  {p.newText ? <ins>{p.newText}</ins> : <Badge tone="ai">{t.deleted}</Badge>}
                </div>
                <p>{p.reason}</p>
              </div>
            ))}
          </section>
        ))}
      </details>
      <details>
        <summary>{t.reviewHistory}</summary>
        {reviews.map((r) => (
          <div key={r.draftVersion}>
            <strong>
              v{r.draftVersion} · {r.findings.length} {t.issues}
            </strong>
            {r.findings.map((f) => (
              <p key={f.id}>
                {f.severity} · {f.quote} — {f.reason}
              </p>
            ))}
          </div>
        ))}
      </details>
      <details>
        <summary>{t.metrics}</summary>
        {(result.metrics ?? []).map((m) => (
          <div key={m.segmentId}>
            <p>
              {t.mean} {m.mean.toFixed(1)} · {t.variance} {m.variance.toFixed(1)} · {t.burstiness}{' '}
              {m.burstiness.toFixed(2)}
            </p>
            <p>
              {t.hits} {m.hits.reduce((total, h) => total + h.count, 0)}
            </p>
            {m.hits.map((h) => (
              <p key={h.phrase}>
                {h.phrase} × {h.count}
              </p>
            ))}
          </div>
        ))}
      </details>
    </>
  );
}
