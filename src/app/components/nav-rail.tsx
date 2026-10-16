import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect } from 'react';
import {
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
export function NavRail() {
  const { data } = useChapter();
  const theme = useUIStore((s) => s.theme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const collapsed = useUIStore((s) => s.navCollapsed);
  const setCollapsed = useUIStore((s) => s.setNavCollapsed);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      const index = Number(event.key) - 1;
      if (navigation[index]) {
        event.preventDefault();
        navigate(`/${navigation[index][0]}`);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [navigate]);
  return (
    <nav className={`nav-rail ${collapsed ? 'is-collapsed' : ''}`} aria-label={zh.brand}>
      <div className="rail-logo">
        <Feather size={22} />
        <span>
          <strong>{zh.brand}</strong>
          <small>{zh.brandEn}</small>
        </span>
      </div>
      {!collapsed && <div className="rail-caption">{studio.space}</div>}
      <div className="rail-links">
        {navigation.map(([key, Icon], index) => {
          const count =
            key === 'changes'
              ? (data?.conflicts.filter((c) => c.status === 'open').length ?? 0)
              : key === 'review' && data && ['waiting_human', 'escalated'].includes(data.run.status)
                ? 1
                : 0;
          return (
            <Tooltip key={key} content={`${zh.nav[key]} · ⌘⌥${index + 1}`}>
              <NavLink
                to={`/${key}`}
                className={`rail-link ${pathname === `/${key}` ? 'active' : ''}`}
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
              </NavLink>
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
