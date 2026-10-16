import { useUIStore } from '@/shared/lib/ui-store';
import { bookPath } from '@/shared/lib/book-context';
import { PendingWritingProvider } from '@/shared/lib/pending-writing';
import { Outlet, Link } from 'react-router-dom';
import { NavRail } from './nav-rail';
import { ErrorBoundary } from '../error-boundary';
import { Badge } from '@/shared/ui';
import { demoWorkspacePath } from '@/shared/lib/writing-mode';
import { liveWriting as t } from '@/shared/lib/messages-live-writing';
/** No demo providers, actions or event streams are mounted in this shell. */
export function LiveWritingLayout() {
  const project = useUIStore((s) => s.projectId),
    branch = useUIStore((s) => s.branchId);
  return (
    <PendingWritingProvider>
      <div className="app-shell">
        <NavRail realWriting />
        <div className="app-main">
          <div className="shell-top">
            <header className="top-bar">
              <Link to={bookPath(project)} className="book-name">
                墨枢
              </Link>
              <Badge tone="human">{t.title}</Badge>
              <span className="muted">
                {project === 'project-zhuoliu' && branch === 'main' ? t.scope : t.unsupported}
              </span>
              <div className="top-actions">
                <Link to={demoWorkspacePath}>{t.demo}</Link>
              </div>
            </header>
          </div>
          <div className="main-body">
            <div className="route-content">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>
    </PendingWritingProvider>
  );
}
