import { lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUIStore } from '@/shared/lib/ui-store';
import { isLiveWorkspace, liveWorkspacePath } from '@/shared/lib/writing-mode';
import { liveWriting as t } from '@/shared/lib/messages-live-writing';
import { AsyncState } from '@/shared/ui';
import { BookFeature } from './book-feature';
const PlannedWorkspace = lazy(() => import('@/features/prepare/PlannedWorkspace'));
const DemoWorkspace = lazy(() => import('@/features/workspace'));
export default function WorkspaceEntry() {
  const { pathname, search } = useLocation();
  const project = useUIStore((s) => s.projectId),
    branch = useUIStore((s) => s.branchId);
  if (isLiveWorkspace(pathname, search, project, branch))
    return (
      <Suspense fallback={<AsyncState loading />}>
        <PlannedWorkspace />
      </Suspense>
    );
  return (
    <BookFeature page="workspace">
      <div className="book-demo-strip">
        {t.demoNotice} · <Link to={liveWorkspacePath()}>{t.back}</Link>
      </div>
      <Suspense fallback={<AsyncState loading />}>
        <DemoWorkspace />
      </Suspense>
    </BookFeature>
  );
}
