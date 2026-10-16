import { useLayoutEffect, type ReactNode } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { AsyncState, Button } from '@/shared/ui';
import { ORIGINAL_PROJECT } from '@/shared/lib/book-context';
import type { BookOverview } from '@/types/domain/library';
/** URL 是跨作品跳转和书签的来源；进入工作区前先原子切换作品、分支、章节。 */
export function BookContext({ children }: { children: ReactNode }) {
  const location = useLocation();
  const shelf = location.pathname === '/' || location.pathname.startsWith('/library');
  const query = new URLSearchParams(location.search);
  const id =
    location.pathname.match(/^\/book\/([^/]+)/)?.[1] ?? query.get('projectId') ?? ORIGINAL_PROJECT;
  const currentId = useUIStore((s) => s.projectId);
  const data = useQuery({
    queryKey: ['book-context', id],
    queryFn: () =>
      api.get<BookOverview>(`/projects/${encodeURIComponent(id)}/overview?branchId=main`),
    enabled: !shelf && id !== ORIGINAL_PROJECT,
    retry: false,
    staleTime: 0,
  });
  const chapterParam = query.get('chapterId'),
    branchParam = query.get('branchId'),
    segment = query.get('segmentId');
  useLayoutEffect(() => {
    if (shelf || (!data.data && id !== ORIGINAL_PROJECT)) return;
    const ui = useUIStore.getState();
    const same = ui.projectId === id;
    const chapterId =
      chapterParam ??
      (same && (id === ORIGINAL_PROJECT || data.data?.chapters.some((c) => c.id === ui.chapterId))
        ? ui.chapterId
        : (data.data?.project.currentChapterId ?? 'ch7'));
    const branchId =
      branchParam ??
      (location.pathname === '/book/project-zhuoliu' ? 'main' : same ? ui.branchId : 'main');
    if (ui.projectId !== id || ui.chapterId !== chapterId || ui.branchId !== branchId)
      ui.setProject(id, chapterId, branchId);
    if (segment) ui.selectSegment(segment);
  }, [id, chapterParam, branchParam, segment, shelf, location.key, location.pathname, data.data]);
  if (shelf) return children;
  if (data.isError)
    return (
      <div className="error-page">
        <h1>作品暂时无法打开</h1>
        <p>{data.error.message}</p>
        <Button onClick={() => void data.refetch()}>重试</Button>
        <Link to="/library">返回作品库</Link>
      </div>
    );
  if ((!data.data && id !== ORIGINAL_PROJECT) || currentId !== id) return <AsyncState loading />;
  return children;
}
