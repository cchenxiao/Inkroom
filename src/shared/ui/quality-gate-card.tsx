import { ShieldCheck, ChevronDown } from 'lucide-react';
import { Badge, Card } from '@/shared/ui';
import { studio as t } from '@/shared/lib/messages-studio';
import type { QualityGateScores } from '@/types/domain';
/** One score surface shared by the writing drawer and human review. */
export function QualityGateCard({
  scores,
  blockers = [],
}: {
  scores: QualityGateScores;
  blockers?: string[];
}) {
  const legacyBlockers = blockers.filter((b) =>
    scores.items.some((score) => !score.calibrated && b.includes(score.label)),
  );
  const gateBlockers = blockers.filter((b) => !legacyBlockers.includes(b));
  return (
    <Card className="quality-gate-card">
      <div className="section-title">
        <ShieldCheck size={16} />
        <h2>{t.gate}</h2>
      </div>
      <p className="muted">{t.gateDescription}</p>
      <div className="quality-p0">
        <span>{t.p0}</span>
        <strong>
          {scores.p0Count} {t.count}
        </strong>
      </div>
      {scores.items
        .filter((score) => !['styleDistance', 'reader'].includes(score.key))
        .map((score) => (
          <details key={score.key} className="quality-metric">
            <summary>
              <span>{score.label}</span>
              <strong>
                {score.value} {score.key === 'aiTaste' ? t.rawValue : t.points}
              </strong>
              <Badge tone={!score.calibrated ? 'muted' : score.passed ? 'success' : 'danger'}>
                {!score.calibrated ? t.hint : score.passed ? t.passed : t.failed}
              </Badge>
              <ChevronDown size={12} />
            </summary>
            {score.calibrated && (
              <p className="muted">
                {score.direction === 'lower' ? '≤' : '≥'} {score.threshold}{' '}
                {score.key === 'aiTaste' ? t.rawValue : t.points}
              </p>
            )}
            {score.features.length ? (
              score.features.map((feature, index) => (
                <div className="quality-evidence" key={index}>
                  <strong>
                    {feature.label} · {feature.value}
                  </strong>
                  <p>{feature.reason}</p>
                  <small>
                    {feature.source} · {feature.calibrated ? t.calibrated : t.hint}
                  </small>
                </div>
              ))
            ) : (
              <p>{t.noEvidence}</p>
            )}
          </details>
        ))}
      <p className="quality-planned">{t.plannedScores}</p>
      {gateBlockers.length > 0 && (
        <div className="gate-blockers">
          {gateBlockers.map((b, i) => (
            <p key={i}>{b}</p>
          ))}
        </div>
      )}
      {legacyBlockers.length > 0 && (
        <details className="quality-legacy">
          <summary>
            {t.legacyLimits} · {legacyBlockers.length} {t.items}
          </summary>
          <p>{t.legacyLimitNote}</p>
          {legacyBlockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
        </details>
      )}
    </Card>
  );
}
