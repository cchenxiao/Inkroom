import { NavLink } from 'react-router-dom';
import {
  Feather,
  NotebookPen,
  SlidersHorizontal,
  ShieldCheck,
  GitCompareArrows,
  GitBranch,
  ChartNoAxesCombined,
  Settings2,
} from 'lucide-react';
import { Tooltip } from '@/shared/ui';
import { zh } from '@/shared/lib/messages';
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
  return (
    <nav className="nav-rail" aria-label={zh.brand}>
      <div className="rail-logo">
        <Feather size={23} />
      </div>
      <div className="rail-links">
        {navigation.map(([key, Icon]) => (
          <Tooltip key={key} content={zh.nav[key]}>
            <NavLink
              to={`/${key}`}
              className={({ isActive }) => `rail-link ${isActive ? 'active' : ''}`}
              aria-label={zh.nav[key]}
            >
              <Icon size={20} />
              {key === 'changes' && data?.conflicts.some((c) => c.status === 'open') && (
                <span className="notification-dot" />
              )}
            </NavLink>
          </Tooltip>
        ))}
      </div>
      <Tooltip content={zh.nav.prepare}>
        <NavLink to="/prepare" className="rail-link rail-settings">
          <Settings2 size={19} />
        </NavLink>
      </Tooltip>
      <div className="avatar" aria-label="作者">
        陈
      </div>
    </nav>
  );
}
