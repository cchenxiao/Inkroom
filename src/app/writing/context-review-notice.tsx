import { Button } from '@/shared/ui';

/** Context freshness is a review task, not a prose error or a request to regenerate. */
export function ContextReviewNotice({
  running = false,
  disabledReason = '',
  error = '',
  retry = false,
  onRecheck,
  onPendingInstruction,
}: {
  running?: boolean;
  disabledReason?: string;
  error?: string;
  retry?: boolean;
  onRecheck: () => void;
  onPendingInstruction?: () => void;
}) {
  return (
    <section className="context-review-notice" aria-label="审核更新" aria-busy={running}>
      <div role="status">
        <strong>{running ? '正在按最新上下文复检…' : '上下文已变化，审核待更新'}</strong>
        <p>正文已保留。复检只更新审核结果，不会重新生成正文。</p>
        {!running && disabledReason && <p>{disabledReason}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      {onPendingInstruction && !running && (
        <Button size="sm" onClick={onPendingInstruction}>
          处理未发送的修改要求
        </Button>
      )}
      <Button
        size="sm"
        loading={running}
        disabled={!!disabledReason}
        disabledReason={disabledReason}
        onClick={onRecheck}
      >
        {running ? '正在复检' : retry || error ? '重试复检' : '按最新上下文复检'}
      </Button>
    </section>
  );
}
