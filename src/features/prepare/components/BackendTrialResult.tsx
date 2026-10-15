import { Badge } from '@/shared/ui';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import type { BackendFinding, BackendRun } from '../types/backend';

/** 只读展示候选与逐轮 patch，不把试运行内容写回工作台。 */
export default function BackendTrialResult({
  result,
}: {
  result: NonNullable<BackendRun['result']>;
}) {
  const reviews = result.reviews ?? [];
  const reviewed = reviews.some((r) => r.draftVersion === result.draftVersion);
  const findings = result.report.findings ?? [];
  const sources = result.context
    ? [
        ...result.context.facts,
        ...result.context.characters.flatMap((c) => [...c.hardTraits, ...c.knows]),
      ]
    : [];
  const finding = (f: BackendFinding) => (
    <div key={f.id} className="page-stack">
      <div>
        <Badge tone={f.severity === 'P0' ? 'danger' : 'info'}>{f.severity}</Badge> ·{' '}
        {t.criticNames[f.critic] ?? f.critic} · {f.repairScope}
      </div>
      <blockquote>{f.quote}</blockquote>
      <p>{f.reason}</p>
      <p>{f.suggestion}</p>
      {f.ruleQuote && (
        <p>
          {t.evidence}：{f.ruleQuote}（{f.ruleRef} · v
          {sources.find((s) => s.id === f.ruleRef)?.version ?? '—'}）
        </p>
      )}
      {f.possibleDialogueLie && <Badge tone="human">{t.dialogueLie}</Badge>}
    </div>
  );
  return (
    <>
      <h3>{t.critics}</h3>
      {(result.criticReviews ?? []).map((c) => (
        <p key={c.critic}>
          {t.criticNames[c.critic] ?? c.critic} · v{c.draftVersion} ·{' '}
          {c.status === 'completed' ? t.completed : t.failed} · {c.findings.length} {t.issues}
          {c.error && <span role="alert"> · {c.error}</span>}
        </p>
      ))}
      {result.route?.kind && (
        <section>
          <h3>
            {t.route} · {t.routes[result.route.kind] ?? result.route.kind}
          </h3>
          <p>{result.route.reason}</p>
          {result.route.needsHuman && <Badge tone="human">{t.humanRequired}</Badge>}
          {result.route.targetIds.length > 0 && (
            <p>
              {t.targets}：{result.route.targetIds.join('、')}
            </p>
          )}
        </section>
      )}
      <h3>{t.candidate}</h3>
      <div className="backend-candidate">
        {result.segments.map((s) => (
          <p key={s.id}>{s.text}</p>
        ))}
      </div>
      <h3>{t.findings}</h3>
      {!reviewed && <p>{t.reviewPending}</p>}
      {reviewed && findings.length === 0 && <p>{t.noFindings}</p>}
      {reviewed && findings.map(finding)}
      <details open>
        <summary>{t.history}</summary>
        {(result.revisions ?? []).length === 0 && <p>{t.noRevision}</p>}
        {(result.revisions ?? []).map((r) => (
          <section key={r.round} className="backend-revision">
            <h4>
              {t.routes[r.kind] ?? t.progress} · {r.round} · v{r.fromVersion} → v{r.toVersion}
            </h4>
            {r.patches.map((p) => (
              <div key={`${p.findingId}-${p.segmentId}`}>
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
      {result.context && (
        <details>
          <summary>{t.facts}</summary>
          <p>
            {t.lockedBeat}：{result.context.beat.id} · v{result.context.beat.version}
          </p>
          {sources.map((s) => (
            <p key={s.id}>
              <strong>
                {s.id} · v{s.version}
              </strong>{' '}
              — {s.text}
            </p>
          ))}
          <h4>{t.sources}</h4>
          {result.context.sources.map((s) => (
            <p key={s.id}>
              {s.id} · v{s.version} — {s.text}
            </p>
          ))}
        </details>
      )}
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
