import { ApiError } from '@/shared/api/client';
import type { BackendRun, FinalizeInput, HumanAction } from '../types/backend';
import { trialApi } from './backend';

export function adoptionBlock(run: BackendRun | undefined, version?: number): string {
  if (!run || version === undefined) return '正在读取候选与版本状态，请稍候。';
  if (run.draftVersion !== version || run.status === 'stale')
    return '正文版本已变化，请更新当前稿。';
  if (run.dismissed) return '这份候选已放弃，请选择当前稿。';
  if (run.commitId) return '这份候选已采用。';
  if (run.result?.findingProposal) return '请先确认或放弃修改预览。';
  if (run.result?.reviewPending) return '修改已保存，请先统一复审当前稿。';
  if (!['waiting_human', 'approved'].includes(run.status))
    return '当前检查尚未完成，请先处理运行状态。';
  if (!run.inputDigest) return '候选的版本依据尚未就绪，请更新状态。';
  return (
    run.approvalBlock || run.actionBlocks?.[run.status === 'approved' ? 'commit' : 'approve'] || ''
  );
}

export function adoptionLabel(run?: BackendRun): string {
  if (run?.planning?.mode !== 'chapter') return '采用本段';
  const ids = run.planning.targetBeatIds?.length
    ? run.planning.targetBeatIds
    : run.result?.segments.map((segment) => segment.beatId).filter(Boolean);
  const count = new Set(ids).size;
  return count ? `采用本批 ${count} 段` : '采用本批候选';
}

export interface AdoptionOperation {
  kind: 'adopt';
  approval?: HumanAction;
  input: FinalizeInput;
}

/** One author click; both existing backend steps retain their frozen idempotency keys. */
export async function adoptCandidate(runId: string, operation: AdoptionOperation) {
  let approved = await trialApi.get(runId);
  const verifyVersion = () => {
    if (
      approved.draftVersion !== operation.input.draftVersion ||
      approved.inputDigest !== operation.input.inputDigest
    )
      throw new ApiError(409, {
        code: 'version_mismatch',
        message: '采用前正文版本已变化，请核对当前稿后重新采用。',
      });
  };
  verifyVersion();
  if (operation.approval && !approved.commitId && approved.status !== 'approved') {
    if (!(approved.status === 'running' && approved.pendingAction?.id === operation.approval.id))
      approved = await trialApi.action(runId, operation.approval);
    // Approval uses the same asynchronous human-action endpoint as edits.
    for (let attempt = 0; approved.status === 'running' && attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      approved = await trialApi.get(runId);
      verifyVersion();
    }
    if (approved.status === 'running')
      throw new Error('批准仍在处理，正文已保留。请重试本次采用，系统会接着完成，不会重复采用。');
  }
  verifyVersion();
  // A lost commit response can be retried without creating a second adoption.
  if (!approved.commitId) {
    const reason = adoptionBlock(approved, operation.input.draftVersion);
    if (reason || approved.status !== 'approved')
      throw new ApiError(409, {
        code: 'adoption_blocked',
        message: approved.error || reason || '批准尚未完成，请更新状态后继续采用。',
      });
  }
  await trialApi.finalize(runId, operation.input);
  return trialApi.get(runId);
}
