import type { BackendRun } from '../types/backend';
import { backendMessages as t } from '@/shared/lib/messages-backend';

export default function BackendCriticLookup({ run }: { run: BackendRun }) {
  if (!run.criticLookups?.length) return null;
  return (
    <section aria-label={t.criticLookupTitle}>
      {run.criticLookups.map((check) => (
        <details
          className="backend-manifest"
          key={check.draftVersion}
          open={check.draftVersion === run.draftVersion}
        >
          <summary>
            {t.criticLookupTitle} · v{check.draftVersion} · {check.review.lookup?.steps.length ?? 0}
            /3
          </summary>
          <p>{t.criticLookupNote}</p>
          {!check.review.lookup?.steps.length && (
            <p>{check.review.status === 'completed' ? t.lookupNotNeeded : t.lookupEmpty}</p>
          )}
          {check.review.lookup?.steps.map((step, index) => (
            <div key={`${index}-${step.callId}`}>
              <strong>
                {index + 1}. {step.query || t.lookupRejected}
              </strong>
              <p>
                {step.status === 'started' && run.status !== 'running'
                  ? t.lookupStopped
                  : (t.lookupStates[step.status] ?? step.status)}{' '}
                · {t.lookupNew} {step.newSources}
              </p>
              {step.refs.map((ref) => (
                <small className="mono" key={ref.id}>
                  {ref.id} · v{ref.version} · {ref.digest.slice(0, 12)}{' '}
                </small>
              ))}
            </div>
          ))}
          {!check.review.lookup?.stop && run.status !== 'running' && (
            <p role="status">{t.criticLookupInterrupted}</p>
          )}
          {check.review.lookup?.stop && (
            <p role="status">
              {t.criticLookupStops[check.review.lookup.stop] ??
                t.lookupStops[check.review.lookup.stop] ??
                check.review.lookup.stop}
            </p>
          )}
          {check.review.evidence?.hits.map((hit) => (
            <details key={hit.record.id}>
              <summary>
                {hit.record.id} · v{hit.record.version} ·{' '}
                {hit.record.kind === 'fact' ? t.criticFact : t.criticPassage}
              </summary>
              <p>{hit.record.text}</p>
            </details>
          ))}
        </details>
      ))}
    </section>
  );
}
