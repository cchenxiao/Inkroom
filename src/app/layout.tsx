import { useChapter } from '@/shared/api/hooks';
import { useShallow } from 'zustand/react/shallow';
import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { NavRail } from './components/nav-rail';
import { TopBar } from './components/top-bar';
import { ChapterSidebar } from './components/chapter-sidebar';
import { CommandPalette } from './components/command-palette';
import { RunEvents } from './run-events';
import { ErrorBoundary } from './error-boundary';
import { useUIStore } from '@/shared/lib/ui-store';
import { AsyncState, Button, Drawer } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
const BiblePanel = lazy(() => import('@/features/bible'));
const RunDrawer = lazy(() => import('@/features/orchestration'));
export function Layout() {
  const chapter = useChapter();
  const { pathname } = useLocation();
  const ui = useUIStore(
    useShallow(({ events: _events, node: _node, streamText: _stream, ...state }) => state),
  );
  const workspace = pathname === '/workspace';
  const [compact, setCompact] = useState(window.innerWidth < 1280);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);
  useEffect(() => {
    const handler = () => setCompact(window.innerWidth < 1280);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  const compactReady = useRef(false);
  useEffect(() => {
    if (!compact) {
      compactReady.current = false;
      return;
    }
    if (!compactReady.current) {
      compactReady.current = true;
      ui.setPanel('left', false);
      ui.setPanel('right', false);
      return;
    }
    if (ui.leftOpen) {
      setLeftDrawer(true);
      ui.setPanel('left', false);
    }
    if (ui.rightOpen) {
      setRightDrawer(true);
      ui.setPanel('right', false);
    }
  }, [compact, ui]);
  return (
    <div className={`app-shell ${ui.focus ? 'focus-mode' : ''}`}>
      <NavRail />
      <div className="app-main">
        <div className="shell-top">
          <TopBar />
        </div>
        {ui.stale && (
          <div className="stale-banner" role="alert">
            <AlertTriangle size={15} />
            {t.stale}
            <Button
              size="sm"
              loading={chapter.isFetching}
              onClick={() =>
                void chapter.refetch().then((result) => {
                  if (result.data && !result.error) ui.setStale(false);
                })
              }
            >
              {t.staleAction}
            </Button>
          </div>
        )}
        <div className={`main-body ${workspace ? 'workspace-body' : ''}`}>
          {workspace && !compact && ui.leftOpen && !ui.focus && <ChapterSidebar />}
          <main className="route-content">
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<AsyncState loading />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
          {workspace && !compact && ui.rightOpen && !ui.focus && (
            <aside className="bible-sidebar">
              <Suspense fallback={<AsyncState loading />}>
                <BiblePanel compact />
              </Suspense>
            </aside>
          )}
        </div>
        {workspace && !ui.focus && (
          <Suspense>
            <RunDrawer />
          </Suspense>
        )}
      </div>
      <CommandPalette />
      <RunEvents />
      {compact && (
        <>
          <Drawer side="left" open={leftDrawer} onOpenChange={setLeftDrawer} title={t.chapterTree}>
            <ChapterSidebar />
          </Drawer>
          <Drawer open={rightDrawer} onOpenChange={setRightDrawer} title={t.belief}>
            <Suspense fallback={<AsyncState loading />}>
              <BiblePanel compact />
            </Suspense>
          </Drawer>
        </>
      )}
    </div>
  );
}
