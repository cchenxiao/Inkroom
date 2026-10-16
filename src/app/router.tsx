import { ReadingRoute } from './components/reading-route';
import { BookFeature } from './components/book-feature';
import { BookContext } from './components/book-context';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Link } from 'react-router-dom';
import { AsyncState, Button } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
import { ErrorPage } from './error-boundary';
import { Layout } from './layout';
const Library = lazy(() => import('@/features/library/LibraryPage'));
const Book = lazy(() => import('@/features/library/BookPage'));
const Wizard = lazy(() => import('@/features/library/WizardPage'));
const Workspace = lazy(() => import('./components/workspace-entry'));
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
    element: (
      <ReadingRoute>
        <BookContext>
          <Layout />
        </BookContext>
      </ReadingRoute>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/library" replace /> },
      { path: 'library', element: wrap(Library) },
      { path: 'library/new', element: wrap(Wizard) },
      { path: 'book/:projectId', element: wrap(Book) },
      { path: 'workspace', element: wrap(Workspace) },
      { path: 'prepare', element: <BookFeature page="prepare">{wrap(Prepare)}</BookFeature> },
      { path: 'review', element: <BookFeature page="review">{wrap(Review)}</BookFeature> },
      { path: 'changes', element: <BookFeature page="changes">{wrap(Changes)}</BookFeature> },
      { path: 'versions', element: <BookFeature page="versions">{wrap(Versions)}</BookFeature> },
      { path: 'reports', element: <BookFeature page="reports">{wrap(Reports)}</BookFeature> },
      {
        path: '*',
        element: (
          <div className="error-page">
            <div className="eyebrow">INKLOOM / 404</div>
            <h1>{t.notFound}</h1>
            <p>{t.notFoundSub}</p>
            <Link to="/library">
              <Button>{t.back}</Button>
            </Link>
          </div>
        ),
      },
    ],
  },
]);
