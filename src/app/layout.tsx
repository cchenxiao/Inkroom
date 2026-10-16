import { useChapter } from '@/shared/api/hooks';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AlertTriangle, PanelLeftOpen, Users, ShieldCheck, BookOpen } from 'lucide-react';
import { NavRail } from './components/nav-rail';
import { TopBar } from './components/top-bar';
import { WorkspaceReview } from './components/workspace-review';
import { ChapterSidebar } from './components/chapter-sidebar';
import { CommandPalette } from './components/command-palette';
import { RunEvents } from './run-events';
import { ErrorBoundary } from './error-boundary';
import { useUIStore } from '@/shared/lib/ui-store';
import { AsyncState, Button, Drawer, Tooltip } from '@/shared/ui';
import { QualityGateCard } from '@/shared/ui/quality-gate-card';
import { finalizeBlockers } from '@/shared/lib/rules';
import { shellText as t } from '@/shared/lib/messages-shell';
import { studio } from '@/shared/lib/messages-studio';
const BiblePanel = lazy(() => import('@/features/bible'));
const RunDrawer = lazy(() => import('@/features/orchestration'));
export function Layout() {
  const chapter = useChapter();
  const { pathname } = useLocation();
  const attention = useUIStore((s) => s.attention);
  const focus = useUIStore((s) => s.focus);
  const leftOpen = useUIStore((s) => s.leftOpen);
  const rightOpen = useUIStore((s) => s.rightOpen);
  const stale = useUIStore((s) => s.stale);
  const workspace = pathname === '/workspace';
  const globalPage = pathname.startsWith('/library') || pathname.startsWith('/book/');
  const projectId = useUIStore((s) => s.projectId);
  const focused = workspace && focus;
  const [compact, setCompact] = useState(window.innerWidth < 1280);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [bibleView, setBibleView] = useState<'bible' | 'gate'>('bible');
  useEffect(() => {
    const handler = () => setCompact(window.innerWidth < 1280);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  useEffect(() => {
    if (!rightOpen) setBibleView('bible');
  }, [rightOpen]);
  const openBible = (view: 'bible' | 'gate') => {
    setBibleView(view);
    useUIStore.getState().setPanel('right', true);
  };
  return (
    <div className={`app-shell ${focused ? 'focus-mode' : ''}`}>
      <NavRail />
      <div className="app-main">
        <div className="shell-top">
          <TopBar />
        </div>
        {stale && !globalPage && (
          <div className="stale-banner" role="alert">
            <AlertTriangle size={15} />
            {workspace || pathname === '/review' ? t.stale : studio.materialStale}
            <Button
              size="sm"
              loading={chapter.isFetching}
              onClick={() =>
                void chapter.refetch().then((result) => {
                  if (result.data && !result.error) useUIStore.getState().setStale(false);
                })
              }
            >
              {workspace || pathname === '/review' ? t.staleAction : studio.refreshMaterials}
            </Button>
          </div>
        )}
        <div
          className={`main-body ${workspace ? 'workspace-body' : ''} ${workspace && attention ? 'has-review' : ''}`}
        >
          {workspace &&
            !focused &&
            (!compact && leftOpen && !attention ? (
              <ChapterSidebar />
            ) : (
              <aside className="structure-rail">
                <Tooltip content={studio.openStructure}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={studio.openStructure}
                    onClick={() =>
                      compact ? setLeftDrawer(true) : useUIStore.getState().setPanel('left', true)
                    }
                  >
                    <PanelLeftOpen size={17} />
                  </Button>
                </Tooltip>
                <span>{t.structure}</span>
              </aside>
            ))}
          <div className="route-content">
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<AsyncState loading />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
          {workspace && attention && !focused && projectId === 'project-zhuoliu' && (
            <WorkspaceReview />
          )}
          {workspace && !focused && !attention && (
            <aside className="bible-rail" aria-label={studio.bible}>
              <Tooltip content={studio.openBible}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={studio.openBible}
                  onClick={() => openBible('bible')}
                >
                  <Users size={17} />
                </Button>
              </Tooltip>
              <Tooltip content={studio.reviewHere}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={studio.reviewHere}
                  disabled={projectId !== 'project-zhuoliu'}
                  disabledReason="此演示作品尚未接入审核"
                  onClick={() => useUIStore.getState().setAttention('review')}
                >
                  <ShieldCheck size={17} />
                </Button>
              </Tooltip>
              <Tooltip content={studio.showGate}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={studio.showGate}
                  onClick={() => openBible('gate')}
                >
                  <ShieldCheck size={17} />
                </Button>
              </Tooltip>
              <BookOpen size={14} />
              <span>{studio.bible}</span>
            </aside>
          )}
        </div>
        {workspace && !focused && projectId === 'project-zhuoliu' && (
          <Suspense>
            <RunDrawer />
          </Suspense>
        )}
      </div>
      <CommandPalette />
      {!globalPage && projectId === 'project-zhuoliu' && <RunEvents />}
      <Drawer
        side="left"
        open={workspace && compact && leftDrawer && !focused}
        onOpenChange={setLeftDrawer}
        title={t.chapterTree}
      >
        <ChapterSidebar onCollapse={() => setLeftDrawer(false)} />
      </Drawer>
      <Drawer
        open={workspace && rightOpen && !focused}
        onOpenChange={(v) => useUIStore.getState().setPanel('right', v)}
        title={bibleView === 'gate' ? studio.gate : studio.bible}
      >
        {chapter.data && (
          <QualityGateCard
            scores={chapter.data.scores}
            blockers={finalizeBlockers(chapter.data.scores, stale)}
          />
        )}
        {bibleView === 'bible' && (
          <Suspense fallback={<AsyncState loading />}>
            <BiblePanel compact />
          </Suspense>
        )}
      </Drawer>
    </div>
  );
}
