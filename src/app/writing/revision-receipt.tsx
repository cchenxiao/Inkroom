import { savedChanges } from './saved-changes';
import { TextChange } from './text-change';
import type { BackendRun } from '@/features/prepare/types/backend';

/** Show submitted requirements separately from the locally unsent editor. */
export function RevisionReceipt({ run }: { run?: BackendRun }) {
  const request =
    run?.pendingAction?.rewrite ??
    run?.result?.authorRequest ??
    run?.result?.context.revisionRequest ??
    run?.result?.context.rewrite;
  if (!request) return null;
  if (
    request.preview &&
    (run?.pendingAction ||
      run?.status === 'running' ||
      run?.result?.findingProposal ||
      run?.result?.reviewPending)
  )
    return null;
  const check = run?.pendingAction
    ? undefined
    : run?.result?.criticReviews?.find(
        (r) =>
          r.critic === 'hard_consistency' &&
          r.draftVersion === run.draftVersion &&
          r.status === 'completed',
      )?.authorCheck;
  const running = run?.status === 'running';
  const label = running
    ? '正在修改与核对'
    : !check
      ? '尚未核对修改要求'
      : check.status === 'addressed'
        ? '修改已核对，待你确认'
        : check.status === 'unresolved'
          ? '修改尚未解决问题'
          : '需要你补充判断';
  // A local finding edit may follow an earlier author request. Its diff must not
  // be presented as the evidence for that unrelated request's authorCheck.
  const revisions = run?.result?.revisions ?? [];
  const matchingRevision =
    !revisions.length ||
    revisions.some(
      (r) =>
        r.toVersion === run?.draftVersion &&
        r.patches.some(
          (p) => p.segmentId === request.segmentId && p.reason === request.instruction,
        ),
    );
  const change = matchingRevision
    ? savedChanges(run).find((change) => change.current && change.segmentId === request.segmentId)
    : undefined;
  return (
    <section className="writing-revision-receipt" aria-label="本次修改结果" aria-live="polite">
      <strong>{label}</strong>
      {change && <TextChange before={change.before} after={change.after} />}
      {!matchingRevision && (
        <p className="muted">以下核对针对此前提交的修改要求；最近保存的修改请查看正文差异。</p>
      )}
      <p className="writing-submitted-request">{request.instruction}</p>
      <p>
        {running
          ? '完成后会保留新候选，并核对是否落实这条要求。'
          : check?.reason || '这份历史候选只有常规检查，尚未针对你的要求验收。可重新提交修改要求。'}
      </p>
      {check && (
        <details>
          <summary>查看正文依据</summary>
          <blockquote>{check.quote}</blockquote>
        </details>
      )}
    </section>
  );
}
