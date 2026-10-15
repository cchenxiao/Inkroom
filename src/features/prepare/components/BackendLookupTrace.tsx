import type { BackendRun } from '../types/backend';
import { backendMessages as t } from '@/shared/lib/messages-backend';

export default function BackendLookupTrace({ run }: { run: BackendRun }) {
  if (!run.lookup && run.currentNode !== 'context_assemble') return null;
  return (
    <details className="backend-manifest" open>
      <summary>
        {t.lookupTitle} · {run.lookup?.steps.length ?? 0}/3
      </summary>
      <p>{t.lookupNote}</p>
      {!run.lookup?.steps.length && <p>{t.lookupEmpty}</p>}
      {run.lookup?.steps.map((step, index) => (
        <div key={`${index}-${step.callId}`}>
          <strong>
            {index + 1}. {step.query || t.lookupRejected}
          </strong>
          <p>
            {t.lookupStates[step.status] ?? step.status} · {t.lookupNew} {step.newSources}
          </p>
          {step.refs.map((ref) => (
            <small className="mono" key={ref.id}>
              {ref.id} · v{ref.version} · {ref.digest.slice(0, 12)}{' '}
            </small>
          ))}
        </div>
      ))}
      {run.lookup?.stop && <p role="status">{t.lookupStops[run.lookup.stop] ?? run.lookup.stop}</p>}
    </details>
  );
}
