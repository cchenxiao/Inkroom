import { TechnicalDetails } from '@/shared/ui/technical-details';
import { sourceLabel } from './source-label';
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
                  : (t.lookupStates[step.status] ?? '查询状态待确认')}{' '}
                · {t.lookupNew} {step.newSources}
              </p>
              {step.refs.map((ref) => (
                <div key={ref.id}>
                  <p>
                    {sourceLabel(run, ref.id, '查询材料')} · v{ref.version}
                  </p>
                  <TechnicalDetails items={{ 材料编号: ref.id, 校验值: ref.digest }} />
                </div>
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
                '查询已停止，请核对记录'}
            </p>
          )}
          {check.review.evidence?.hits.map((hit) => (
            <details key={hit.record.id}>
              <summary>
                {sourceLabel(run, hit.record.id, '查证材料')} · v{hit.record.version} ·{' '}
                {hit.record.kind === 'fact' ? t.criticFact : t.criticPassage}
              </summary>
              <p>{hit.record.text}</p>
              <TechnicalDetails items={{ 证据编号: hit.record.id, 校验值: hit.digest }} />
            </details>
          ))}
        </details>
      ))}
    </section>
  );
}
