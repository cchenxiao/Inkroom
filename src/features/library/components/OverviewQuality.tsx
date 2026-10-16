import { ArrowUpRight, Flame, ShieldCheck } from 'lucide-react';
import { Button, Card } from '@/shared/ui';
import { QualityGateCard } from '@/shared/ui/quality-gate-card';
import { libraryMessages as t } from '@/shared/lib/messages-library';
import type { BookOverview } from '@/types/domain/library';

export default function OverviewQuality({
  book,
  onReports,
  onChapter,
}: {
  book: BookOverview;
  onReports: () => void;
  onChapter: (chapterId: string, segmentId?: string) => void;
}) {
  return (
    <section className="overview-quality" aria-label={t.quality}>
      <div className="overview-panel-heading">
        <h2>
          <ShieldCheck size={16} />
          {t.quality}
        </h2>
        <Button variant="ghost" size="sm" onClick={onReports}>
          详细评测
          <ArrowUpRight size={12} />
        </Button>
      </div>
      <p className="muted">全书展示汇总 · Mock 数据，非 Go 后端评测结果</p>
      {book.totalWords > 0 || book.quality.items.length > 0 ? (
        <details className="overview-gate-details">
          <summary>
            门禁详情 · {book.quality.p0Count} 个 P0 ·{' '}
            {book.quality.canFinalize ? '已通过' : '尚未通过'}
          </summary>
          <QualityGateCard scores={book.quality} blockers={book.quality.blockers} />
        </details>
      ) : (
        <Card>
          <p className="muted">尚无评测数据；完成试写后查看质量提示。</p>
        </Card>
      )}
      <Card className="overview-heatmap">
        <h3>
          <Flame size={15} />
          {t.heatmap}
        </h3>
        <p className="muted">按章查看原始值 · 未校准时仅作提示</p>
        <div className="overview-heatmap-cells">
          {book.heatmap.map((cell) => (
            <button
              key={cell.chapterId}
              className={
                cell.value === null
                  ? 'heat-none'
                  : cell.value >= 0.6
                    ? 'heat-high'
                    : cell.value >= 0.3
                      ? 'heat-mid'
                      : 'heat-low'
              }
              aria-label={`${cell.label}，AI 味${cell.value === null ? '暂无数据' : cell.value.toFixed(2)}，前往章节`}
              onClick={() => onChapter(cell.chapterId)}
            >
              <span>{cell.label}</span>
              <strong>{cell.value === null ? '—' : cell.value.toFixed(2)}</strong>
            </button>
          ))}
        </div>
        {!book.heatmap.length && <p className="muted">暂无章节评测</p>}
      </Card>
    </section>
  );
}
