import { Button } from '@/shared/ui';
import type { BackendRun } from '@/features/prepare/types/backend';

/** Only display checks bound to this saved candidate; never bless unsaved edits. */
export function QualitySummary({
  run,
  dirty = false,
  onPrepareCondense,
}: {
  run?: BackendRun;
  dirty?: boolean;
  onPrepareCondense?: (target: number) => void;
}) {
  if (!run || dirty || ['running', 'stale', 'interrupted'].includes(run.status)) return null;
  const reviews = run.result?.criticReviews?.filter(
    (r) => r.draftVersion === run.draftVersion && r.status === 'completed',
  );
  const length = reviews?.find((r) => r.critic === 'ai_taste')?.length;
  const continuity =
    run.status === 'failed'
      ? undefined
      : reviews?.find((r) => r.critic === 'hard_consistency')?.continuity;
  const comparison = run.result?.reviewComparison;
  if (!length && !continuity?.length && !comparison) return null;
  const issues = continuity?.filter((c) => c.status !== 'clear').length || 0;
  return (
    <section className="writing-quality-summary" aria-label="篇幅与衔接">
      {comparison && comparison.toVersion === run.draftVersion && (
        <p>
          与上轮对比：新增 {comparison.added} 条 · 原引用仍有意见 {comparison.continued} 条 ·
          本轮未再报出 {comparison.notRepeated} 条。未再报出不等于作者确认已解决。
        </p>
      )}
      {length && (
        <p className={length.status === 'within' ? 'muted' : 'writing-length-notice'}>
          {length.scope === 'chapter' ? '本批候选' : '本段'}{' '}
          <span className="stat-number">{length.actual.toLocaleString()}</span> 字 · 目标{' '}
          <span className="stat-number">{length.target.toLocaleString()}</span> 字
          {length.status !== 'within' && (
            <>
              {' '}
              ·{' '}
              {length.status === 'long'
                ? '篇幅偏长，可压缩重复描写'
                : '篇幅偏短，可检查情节是否展开充分'}
            </>
          )}
        </p>
      )}
      {!!continuity?.length && (
        <details>
          <summary>衔接核对 · {issues ? `${issues} 段待处理` : '模型暂未发现冲突'}</summary>
          <p className="muted">以下是本版正文的模型判断，仍需你核对；不作为已确认设定。</p>
          {continuity.map((c, i) => (
            <div className="writing-continuity-item" key={c.segmentId}>
              <strong>
                {continuity.length === 1 ? '当前段' : `第 ${i + 1} 段`} ·{' '}
                {c.status === 'clear' ? '已核对' : '待核对'}
              </strong>
              <p>{c.reason}</p>
              <blockquote>{c.openingQuote}</blockquote>
              {c.closingQuote !== c.openingQuote && <blockquote>{c.closingQuote}</blockquote>}
            </div>
          ))}
        </details>
      )}
      {length?.scope === 'beat' && length.status === 'long' && onPrepareCondense && (
        <Button size="sm" variant="secondary" onClick={() => onPrepareCondense(length.target)}>
          填写精简本段的要求
        </Button>
      )}
      {length && length.status !== 'within' && (
        <p className="muted">
          篇幅是创作参考，系统不会自动删字或截断正文。按非空白字符计数，含标点。
        </p>
      )}
    </section>
  );
}
