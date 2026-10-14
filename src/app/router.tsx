import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Link } from 'react-router-dom';
import { AsyncState, Button } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
import { ErrorPage } from './error-boundary';
import { Layout } from './layout';
const Workspace = lazy(() => import('@/features/workspace'));
const Prepare = lazy(() => import('@/features/prepare'));
const Review = lazy(() => import('@/features/review'));
const Changes = lazy(() => import('@/features/changes'));
const Versions = lazy(() => import('@/features/versions'));
const Reports = lazy(() => import('@/features/reports'));
const wrap = (Page: typeof Workspace) => (
  <Suspense fallback={<AsyncState loading />}>
    <Page />
  </Suspense>
);
export const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/workspace" replace /> },
      { path: 'workspace', element: wrap(Workspace) },
      { path: 'prepare', element: wrap(Prepare) },
      { path: 'review', element: wrap(Review) },
      { path: 'changes', element: wrap(Changes) },
      { path: 'versions', element: wrap(Versions) },
      { path: 'reports', element: wrap(Reports) },
      {
        path: '*',
        element: (
          <div className="error-page">
            <div className="eyebrow">INKLOOM / 404</div>
            <h1>{t.notFound}</h1>
            <p>{t.notFoundSub}</p>
            <Link to="/workspace">
              <Button>{t.back}</Button>
            </Link>
          </div>
        ),
      },
    ],
  },
]);
