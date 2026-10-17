import { ReviewProgress } from '../../src/features/prepare/components/review-progress';
import React from 'react';
import { ReviewFailure } from '../../src/app/writing/review-failure';
import { createRoot } from 'react-dom/client';
import { QualitySummary } from '../../src/app/writing/quality-summary';
import type { BackendRun } from '../../src/features/prepare/types/backend';
import '../../src/styles/globals.css';
import '../../src/app/writing/writing.css';
const run = {
  status: 'waiting_human',
  draftVersion: 2,
  result: {
    criticReviews: [
      {
        critic: 'ai_taste',
        status: 'completed',
        draftVersion: 2,
        length: {
          scope: 'chapter',
          actual: 3294,
          target: 2400,
          lower: 1800,
          upper: 3200,
          status: 'long',
        },
      },
      {
        critic: 'hard_consistency',
        status: 'completed',
        draftVersion: 2,
        continuity: [
          {
            segmentId: 'test',
            status: 'conflict',
            openingQuote: '她把蓝布袋放进铁柜，关上柜门。',
            closingQuote: '信封放在桌上，紧挨着蓝布袋。',
            reason: '布袋已经入柜，后文又出现在桌上，缺少取回的动作。',
          },
        ],
      },
    ],
  },
} as unknown as BackendRun;
const progress = new URLSearchParams(location.search).has('progress');
const progressRun = {
  status: 'running',
  activeRoles: ['hard_consistency'],
  activeCalls: [
    {
      number: 1,
      role: 'hard_consistency',
      phase: 'started',
      activity: 'consistency',
      startedAt: new Date(Date.now() - 80000).toISOString(),
      timeoutMs: 90000,
    },
  ],
} as BackendRun;
const failed = new URLSearchParams(location.search).has('failed');
const quoteFailure = new URLSearchParams(location.search).get('failed') === 'quote';
const failedRun = {
  ...run,
  status: 'failed',
  planning: { mode: 'chapter' },
  result: {
    ...run.result,
    criticReviews: [
      { critic: 'ai_taste', draftVersion: 2, status: 'completed', findings: [] },
      {
        critic: 'hard_consistency',
        draftVersion: 2,
        status: 'failed',
        failureCode: quoteFailure ? 'invalid_content' : 'model_truncated',
        error: quoteFailure
          ? 'consistency critic: invalid_content: author assessment quote must exist in target'
          : undefined,
      },
    ],
  },
} as unknown as BackendRun;
createRoot(document.getElementById('root')!).render(
  <main
    style={{
      width: 'min(400px, 100%)',
      margin: '32px auto',
      padding: 24,
      background: 'var(--panel)',
    }}
  >
    <h2>审核本章</h2>
    <p>核对正文，提出修改或批准当前稿。</p>
    {progress ? (
      <ReviewProgress run={progressRun} />
    ) : failed ? (
      <ReviewFailure
        run={failedRun}
        disabled={false}
        onRetry={() => {
          document.title = 'review-retry-requested';
        }}
      />
    ) : (
      <QualitySummary run={run} />
    )}
  </main>,
);
