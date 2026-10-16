import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  readReadingMemory,
  rememberReadingRoute,
  resolveReadingRoute,
} from '@/shared/lib/route-context';
export function ReadingRoute({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation();
  const target = resolveReadingRoute(pathname, search, hash, readReadingMemory());
  useEffect(() => {
    if (!target) rememberReadingRoute(pathname, search);
  }, [pathname, search, target]);
  return target ? <Navigate replace to={target} /> : children;
}
