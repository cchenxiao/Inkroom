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
    (run?.status === 'running' || run?.result?.findingProposal || run?.result?.reviewPending)
  )
    return null;
  const check = run?.result?.criticReviews?.find(
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
  return (
    <section className="writing-revision-receipt" aria-label="本次修改结果" aria-live="polite">
      <strong>{label}</strong>
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
