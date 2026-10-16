import { Badge, Button } from '@/shared/ui';
import { styleTrialMessages as t } from '@/shared/lib/messages-style-trial';
import type { StyleTrialJob } from '../types/style-trial';
export default function StyleTrialSamples({
  job,
  stale,
  busy,
  onChoose,
}: {
  job: StyleTrialJob;
  stale: boolean;
  busy: boolean;
  onChoose: (index: number) => void;
}) {
  const report = job.report;
  return (
    <>
      {stale && (
        <p role="alert" className="page-error">
          {t.old}
        </p>
      )}
      {report.status === 'running' && (
        <p role="status" className="planning-running">
          {t.running}
        </p>
      )}
      {report.message && (
        <p role="status" className="text-dim">
          {report.message}
        </p>
      )}
      <div className="style-trial-pair">
        {report.samples.map((sample, i) => (
          <article className="style-trial-sample" key={sample.variant.id}>
            <div className="planning-heading">
              <h3>{sample.variant.label}</h3>
              <Badge tone="ai">{report.model}</Badge>
            </div>
            <p className="style-sample-prose">{sample.text}</p>
            <div className="style-sample-stats">
              <small>{t.stats}</small>
              <p>
                {t.mean} {sample.stats.mean.toFixed(1)} 字 / 句 · {t.variance}{' '}
                {sample.stats.variance.toFixed(1)}
              </p>
              <p>
                {t.hits}：
                {sample.stats.hits.map((h) => `${h.phrase} × ${h.count}`).join('；') || t.noHits}
              </p>
            </div>
            <Button
              disabled={stale || busy || report.status !== 'completed'}
              disabledReason={stale ? t.old : t.archived}
              onClick={() => onChoose(i)}
            >
              {t.choose}
            </Button>
          </article>
        ))}
      </div>
      <details className="planning-trace">
        <summary>{t.trace}</summary>
        <p>
          立意 v{report.input.source.version} · 方向 v{report.input.selection.version} ·{' '}
          {job.promptVersion} · {job.schemaVersion}
        </p>
        <p>{report.input.beat.summary}</p>
        <p>{report.input.beat.facts.join('；')}</p>
        <p>
          {t.outcome}：{report.input.beat.outcome}
        </p>
        {report.input.variants.map((v) => (
          <p key={v.id}>
            {v.label}：{v.instructions}
          </p>
        ))}
        <p className="trace">{report.inputDigest}</p>
        {report.calls.map((c) => (
          <p key={`${c.number}-${c.phase}`}>
            #{c.number} · {c.phase} · {c.promptVersion} · {c.elapsedMs} ms ·{' '}
            {c.usage.known ? `${c.usage.inputTokens + c.usage.outputTokens} tokens` : '用量未知'}
          </p>
        ))}
      </details>
    </>
  );
}
