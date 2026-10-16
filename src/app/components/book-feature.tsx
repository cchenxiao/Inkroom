import type { ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useUIStore } from '@/shared/lib/ui-store';
import { bookPath, ORIGINAL_PROJECT } from '@/shared/lib/book-context';
import { useChapter, useResource } from '@/shared/api/hooks';
import { AsyncState, PageHeader } from '@/shared/ui';
import type { BookPlan } from '@/types/domain/library';
const names: Record<string, string> = {
  review: '人工审核',
  changes: '变更冲突',
  versions: '版本试写',
  reports: '质量评测',
};
/** 能力边界与视觉页面分开；未接线的作品不能落到浊流的默认演示操作。 */
export function BookFeature({ page, children }: { page: string; children: ReactNode }) {
  const id = useUIStore((s) => s.projectId),
    chapter = useChapter();
  const [params] = useSearchParams();
  const plan = useResource<BookPlan>(
    `/projects/${id}/planning`,
    id !== ORIGINAL_PROJECT && page === 'workspace',
  );
  if (id === ORIGINAL_PROJECT) return children;
  const step =
    { premise: 0, style: 1, world: 2, outline: 3, knowledge: 2 }[
      params.get('section') ?? 'premise'
    ] ?? 0;
  if (page === 'prepare')
    return (
      <Navigate replace to={`/library/new?projectId=${encodeURIComponent(id)}&step=${step}`} />
    );
  if (page === 'workspace') {
    if (plan.isLoading || chapter.isLoading) return <AsyncState loading />;
    if (plan.error || chapter.error)
      return (
        <AsyncState
          error={plan.error ?? chapter.error}
          onRetry={() => {
            void plan.refetch();
            void chapter.refetch();
          }}
        />
      );
    if (plan.data?.steps[3].locked && chapter.data?.segments.length)
      return (
        <>
          <div className="book-demo-strip">
            演示手稿 · 修改仅保存在本地浏览器；Agent、事实同步与审核尚未接入此作品。
          </div>
          {children}
        </>
      );
    return (
      <div className="page-content">
        <PageHeader title="先确认这一章的写作方向" description="" eyebrow="" />
        <p>章纲尚未锁定，或本章场景与 Beat 尚未展开。当前向导只细化第一章。</p>
        <Link to={`/library/new?projectId=${id}&step=3`}>前往章纲</Link> ·{' '}
        <Link to={bookPath(id)}>返回作品总览</Link>
      </div>
    );
  }
  return (
    <div className="page-content">
      <PageHeader title={names[page]} description="" eyebrow="" />
      <div className="ui-card">
        <h2>此作品尚未接入{names[page]}</h2>
        <p>
          这是独立的演示作品。当前可完成四步规划、手动试写和创建独立分支；评审、变更传播、版本合并与评测尚未接线。
        </p>
        <Link to={bookPath(id)}>返回作品总览</Link>
      </div>
    </div>
  );
}
