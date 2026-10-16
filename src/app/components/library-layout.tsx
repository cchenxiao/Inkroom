import { useLayoutEffect } from 'react';
import { Feather, Moon, Sun, ArrowLeft } from 'lucide-react';
import { useUIStore } from '@/shared/lib/ui-store';
import { Button } from '@/shared/ui';
import { libraryHomeText as t } from '@/shared/lib/messages-library-home';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { NavRail } from './nav-rail';
import { ErrorBoundary } from '../error-boundary';
/** The real shelf/overview must not mount demo chapter queries, counts or event streams. */
export function LibraryLayout() {
  const { pathname } = useLocation();
  const theme = useUIStore((s) => s.theme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  if (pathname.startsWith('/library'))
    return (
      <div className="library-home">
        <header className="library-home-header">
          <Link className="library-home-brand" to="/library">
            <Feather size={24} />
            <strong>墨枢</strong>
            <span>INKLOOM</span>
          </Link>
          {pathname === '/library/new' && (
            <Link className="library-home-back" to="/library">
              <ArrowLeft size={15} />
              {t.back}
            </Link>
          )}
          <div className="library-home-account">
            <Button
              variant="ghost"
              size="icon"
              aria-label={theme === 'day' ? t.night : t.day}
              onClick={() => useUIStore.getState().setTheme(theme === 'day' ? 'night' : 'day')}
            >
              {theme === 'day' ? <Moon size={18} /> : <Sun size={18} />}
            </Button>
            <span className="avatar" aria-label={t.author}>
              陈
            </span>
          </div>
        </header>
        <div className="library-home-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <NavRail realWriting />
      <div className="app-main">
        <div className="shell-top">
          <header className="top-bar">
            <Link to="/library" className="book-name">
              墨枢
            </Link>
            <span className="muted">作品空间</span>
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
  );
}
