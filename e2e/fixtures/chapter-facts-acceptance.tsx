// Browser-only acceptance surface; not imported by the application or production routes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Providers } from '../../src/app/providers';
import { PendingWritingProvider } from '../../src/shared/lib/pending-writing';
import ChapterPublication from '../../src/features/prepare/components/ChapterPublication';
import type { ChapterReviewJob } from '../../src/features/prepare/api/chapter-review';
import review from './chapter-facts-review.json';
import '../../src/styles/globals.css';
import '../../src/features/prepare/prepare.css';

document.documentElement.dataset.theme = 'day';
const router = createMemoryRouter([
  {
    path: '/',
    element: (
      <PendingWritingProvider>
        <main style={{ maxWidth: 760, padding: 32, margin: 'auto' }}>
          <h1>章末事实与定稿 · 隔离验收</h1>
          <p>测试章稿：陆青把铜扣交给沈砚。</p>
          <ChapterPublication job={review as ChapterReviewJob} blocked={false} />
        </main>
      </PendingWritingProvider>
    ),
  },
]);
createRoot(document.getElementById('root')!).render(
  <Providers>
    <RouterProvider router={router} />
  </Providers>,
);
