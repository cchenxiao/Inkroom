import type { BackendRun } from '@/features/prepare/types/backend';
import { Button } from '@/shared/ui';
import { TechnicalDetails } from '@/shared/ui/technical-details';

const criticName = (name: string) => (name === 'hard_consistency' ? '一致性审核' : '语言审查');

/** Use the failed check's persisted evidence, not the generic run stop message. */
export function reviewFailureInfo(run?: BackendRun) {
  if (!run || run.status !== 'failed') return null;
  const reviews =
    run.result?.criticReviews?.filter((r) => r.draftVersion === run.draftVersion) ?? [];
  const failed = reviews.filter((r) => r.status === 'failed');
  if (!failed.length) return null;
  const cause = failed.find((r) => r.failureCode && r.failureCode !== 'canceled') ?? failed[0];
  const descriptions: Record<string, string> = {
    model_truncated: '审核回答达到输出上限，未返回完整结果。',
    timeout: '审核等待超时，尚未取得完整结果。',
    budget_exhausted: '本次运行的检查额度已用完。',
    canceled: '本次审核已中断。',
    invalid_content: '审核意见引用的证据或修复范围未通过校验，不能作为有效审核结果。',
    invalid_schema: '模型返回的审核结果格式不完整或不符合要求，系统无法读取。',
  };
  const error = cause.error ?? '';
  const quoteMismatch = error.includes('author assessment quote must exist in target');
  const missingAssessment = error.includes('missing author request assessment');
  const unchanged = error.includes('unchanged text cannot satisfy a rewrite request');
  const detail = quoteMismatch
    ? '审核模型引用的文字在本次目标正文中找不到原句，无法证明它已核对你的修改要求，因此这份审核结果未被采纳。'
    : missingAssessment
      ? '审核模型没有返回对你这次修改要求的核对结论，因此审核未完成。'
      : unchanged
        ? '正文尚未变化，审核模型却声称修改要求已满足，系统拒绝了这个不可靠的结论。'
        : (descriptions[cause.failureCode ?? ''] ??
          '审核没有返回有效结果；现有记录不足以确定更具体的原因。');
  return {
    title: `${criticName(cause.critic)}未完成`,
    detail,
    code: quoteMismatch
      ? 'author_quote_mismatch'
      : missingAssessment
        ? 'author_check_missing'
        : unchanged
          ? 'unchanged_rewrite'
          : (cause.failureCode ?? 'review_failed'),
    stage: criticName(cause.critic),
    completed: reviews.filter((r) => r.status === 'completed').map((r) => criticName(r.critic)),
  };
}

export function ReviewFailure({
  run,
  onRetry,
  disabled,
  disabledReason = '',
  requestError = '',
  onPendingInstruction,
}: {
  run?: BackendRun;
  onRetry: () => void;
  disabled: boolean;
  disabledReason?: string;
  requestError?: string;
  onPendingInstruction?: () => void;
}) {
  const failure = reviewFailureInfo(run);
  if (!failure || !run) return null;
  return (
    <section
      className="writing-quality-summary writing-run-failure"
      aria-label="检查未完成"
      role="status"
    >
      <strong>{failure.title}</strong>
      <p>{failure.detail}</p>
      <p className="muted">
        当前已保存正文 v{run.draftVersion} 保留；
        {failure.completed.length ? `${failure.completed.join('、')}已完成，但` : ''}
        本轮尚未通过完整审核。
      </p>
      <p className="muted">
        下一步：保留正文，重新检查{run.planning?.mode === 'chapter' ? '整章' : '本段'}
        。只更新审核，不会重写正文；会产生新的模型调用。
      </p>
      <div className="page-actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          disabledReason={disabledReason}
          onClick={onRetry}
        >
          保留正文，重新检查{run.planning?.mode === 'chapter' ? '整章' : '本段'}
        </Button>
        {onPendingInstruction && (
          <Button size="sm" variant="ghost" onClick={onPendingInstruction}>
            处理未发送的修改要求
          </Button>
        )}
      </div>
      {disabled && disabledReason && <p>{disabledReason}</p>}
      {requestError && <p role="alert">{requestError}</p>}
      <TechnicalDetails
        items={{ 失败环节: failure.stage, 原因代码: failure.code, 运行编号: run.id }}
      />
    </section>
  );
}
