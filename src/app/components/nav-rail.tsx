import { liveWorkspacePath, livePreparePath } from '@/shared/lib/writing-mode';
import { liveWriting as liveText } from '@/shared/lib/messages-live-writing';
import { workPath, bookPath } from '@/shared/lib/book-context';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Sun,
  Moon,
  Feather,
  NotebookPen,
  SlidersHorizontal,
  ShieldCheck,
  GitCompareArrows,
  GitBranch,
  ChartNoAxesCombined,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Tooltip } from '@/shared/ui';
import { zh } from '@/shared/lib/messages';
import { studio } from '@/shared/lib/messages-studio';
import { useUIStore } from '@/shared/lib/ui-store';
import { useChapter } from '@/shared/api/hooks';
const navigation = [
  ['prepare', SlidersHorizontal],
  ['workspace', NotebookPen],
  ['review', ShieldCheck],
  ['changes', GitCompareArrows],
  ['versions', GitBranch],
  ['reports', ChartNoAxesCombined],
] as const;
export function NavRail({ realWriting = false }: { realWriting?: boolean }) {
  const chapter = useChapter(!realWriting);
  const data = realWriting ? undefined : chapter.data;
  const theme = useUIStore((s) => s.theme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const collapsed = useUIStore((s) => s.navCollapsed);
  const setCollapsed = useUIStore((s) => s.setNavCollapsed);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const plannedChapter = new URLSearchParams(search).get('planningChapterId') ?? undefined;
  const realPath = useCallback(
    (panel?: 'assembly') => {
      // Re-entering the current workspace keeps the selected beat and open panel.
      const query = new URLSearchParams(
        pathname === '/workspace' ? search : liveWorkspacePath(plannedChapter).split('?')[1],
      );
      if (panel) query.set('panel', panel);
      return `/workspace?${query}`;
    },
    [pathname, search, plannedChapter],
  );
  const projectId = useUIStore((s) => s.projectId);
  const chapterId = useUIStore((s) => s.chapterId);
  const globalPage = pathname.startsWith('/library');
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      const index = Number(event.key) - 1;
      if (navigation[index] && (!realWriting || index < 3)) {
        event.preventDefault();
        navigate(
          realWriting && navigation[index][0] !== 'prepare'
            ? realPath(navigation[index][0] === 'review' ? 'assembly' : undefined)
            : realWriting
              ? livePreparePath('premise', plannedChapter)
              : workPath(navigation[index][0], projectId, chapterId),
        );
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [navigate, projectId, chapterId, realWriting, plannedChapter, realPath]);
  return (
    <nav className={`nav-rail ${collapsed ? 'is-collapsed' : ''}`} aria-label={zh.brand}>
      <Link className="rail-logo" to="/library" aria-label="墨枢 · 返回作品库">
        <Feather size={22} />
        <span>
          <strong>{zh.brand}</strong>
          <small>{zh.brandEn}</small>
        </span>
      </Link>
      <Tooltip content="返回书架首页">
        <Link to="/library" className="rail-home-link" aria-label="返回书架首页">
          <ArrowLeft size={16} />
          <span className="rail-label">返回书架</span>
        </Link>
      </Tooltip>
      {!collapsed && <div className="rail-caption">{studio.space}</div>}
      <div className="rail-links">
        {!globalPage && (
          <Tooltip content="作品总览">
            <Link
              to={bookPath(projectId)}
              className={`rail-link ${pathname.startsWith('/book/') ? 'active' : ''}`}
            >
              <Feather size={18} />
              <span className="rail-label">作品总览</span>
            </Link>
          </Tooltip>
        )}
        {!globalPage &&
          navigation.map(([key, Icon], index) => {
            // Live review is a panel within writing, not a second workspace.
            if (realWriting && key === 'review') return null;
            const count =
              key === 'changes'
                ? (data?.conflicts.filter((c) => c.status === 'open').length ?? 0)
                : key === 'review' &&
                    data &&
                    ['waiting_human', 'escalated'].includes(data.run.status)
                  ? 1
                  : 0;
            if (realWriting && index > 2)
              return (
                <Tooltip key={key} content={liveText.unavailable}>
                  <span className="rail-link" role="link" aria-disabled="true" tabIndex={0}>
                    <Icon size={18} />
                    <span className="rail-label">{zh.nav[key]}</span>
                  </span>
                </Tooltip>
              );
            return (
              <Tooltip key={key} content={`${zh.nav[key]} · ⌘⌥${index + 1}`}>
                <Link
                  to={
                    realWriting && key !== 'prepare'
                      ? realPath()
                      : realWriting
                        ? livePreparePath('premise', plannedChapter)
                        : workPath(key, projectId, chapterId)
                  }
                  className={`rail-link ${(realWriting ? (key === 'prepare' && pathname === '/prepare') || (pathname === '/workspace' && key === 'workspace') : pathname === `/${key}`) ? 'active' : ''}`}
                  aria-current={
                    (
                      realWriting
                        ? (key === 'workspace' && pathname === '/workspace') ||
                          (key === 'prepare' && pathname === '/prepare')
                        : pathname === `/${key}`
                    )
                      ? 'page'
                      : undefined
                  }
                  aria-label={zh.nav[key]}
                >
                  <Icon size={18} />
                  <span className="rail-label">{zh.nav[key]}</span>
                  {count > 0 ? (
                    <span className="nav-count" aria-label={`${count} 项待办`}>
                      <i />
                      {!collapsed && count}
                    </span>
                  ) : (
                    <kbd>⌥{index + 1}</kbd>
                  )}
                </Link>
              </Tooltip>
            );
          })}
      </div>
      <div className="rail-bottom">
        <Tooltip content={theme === 'day' ? studio.switchNight : studio.switchDay}>
          <button
            className="rail-fold"
            aria-label={theme === 'day' ? studio.switchNight : studio.switchDay}
            onClick={() => useUIStore.getState().setTheme(theme === 'day' ? 'night' : 'day')}
          >
            {theme === 'day' ? <Sun size={17} /> : <Moon size={17} />}
            {!collapsed && <span>{theme === 'day' ? studio.day : studio.night}</span>}
          </button>
        </Tooltip>
        <Tooltip content={collapsed ? studio.expandNav : studio.collapseNav}>
          <button
            className="rail-fold"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? studio.expandNav : studio.collapseNav}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            {!collapsed && <span>{studio.collapseNav}</span>}
          </button>
        </Tooltip>
        <div className="rail-author">
          <div className="avatar" aria-label="作者">
            陈
          </div>
          {!collapsed && (
            <span>
              陈<small>作者 · 本地空间</small>
            </span>
          )}
        </div>
      </div>
    </nav>
  );
}
