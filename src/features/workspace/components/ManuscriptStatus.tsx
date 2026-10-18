import { manuscriptStatus, type ManuscriptStatusInput } from '../manuscript-status';

export function ManuscriptStatus({
  part,
  snapshot = false,
}: {
  part: ManuscriptStatusInput;
  snapshot?: boolean;
}) {
  const state = manuscriptStatus(part, snapshot);
  return (
    <span className={`manuscript-version-state state-${state.tone}`}>
      <span className="manuscript-state-label">{state.label}</span>
      {state.detail && <span className="manuscript-state-detail">{state.detail}</span>}
    </span>
  );
}
