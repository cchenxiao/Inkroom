import { TechnicalDetails } from '@/shared/ui/technical-details';
import { sourceLabel } from './source-label';
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
      {!run.lookup?.steps.length && (
        <p>{run.lookup?.stop === 'ready' ? t.lookupNotNeeded : t.lookupEmpty}</p>
      )}
      {run.lookup?.steps.map((step, index) => (
        <div key={`${index}-${step.callId}`}>
          <strong>
            {index + 1}. {step.query || t.lookupRejected}
          </strong>
          <p>
            {t.lookupStates[step.status] ?? '查询状态待确认'} · {t.lookupNew} {step.newSources}
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
      {run.lookup?.stop && (
        <p role="status">{t.lookupStops[run.lookup.stop] ?? '查询已停止，请核对记录'}</p>
      )}
    </details>
  );
}
