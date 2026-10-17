import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RevisionReceipt } from './revision-receipt';
import type { BackendRun } from '@/features/prepare/types/backend';
const run = {
  status: 'waiting_human',
  draftVersion: 3,
  result: {
    context: { rewrite: { instruction: '中间撕了一张怎么会隔一页呢？' } },
    criticReviews: [],
  },
} as unknown as BackendRun;
it('distinguishes a submitted legacy request from a verified result', () => {
  render(<RevisionReceipt run={run} />);
  expect(screen.getByText('尚未核对修改要求')).toBeInTheDocument();
  expect(screen.getByText('中间撕了一张怎么会隔一页呢？')).toBeInTheDocument();
});
it('shows unresolved reason and evidence only from the current review', () => {
  const current = {
    ...run,
    result: {
      ...run.result!,
      criticReviews: [
        {
          critic: 'hard_consistency',
          draftVersion: 3,
          status: 'completed',
          findings: [],
          authorCheck: {
            status: 'unresolved' as const,
            reason: '仍混淆纸张与页码。',
            quote: '下一张是十九页',
          },
        },
      ],
    },
  };
  const view = render(<RevisionReceipt run={current} />);
  expect(screen.getByText('修改尚未解决问题')).toBeInTheDocument();
  expect(screen.getByText('仍混淆纸张与页码。')).toBeInTheDocument();
  view.rerender(<RevisionReceipt run={{ ...current, draftVersion: 4 }} />);
  expect(screen.queryByText('修改尚未解决问题')).not.toBeInTheDocument();
  expect(screen.getByText('尚未核对修改要求')).toBeInTheDocument();
});
it('does not describe a running request as already verified', () => {
  render(<RevisionReceipt run={{ ...run, status: 'running' }} />);
  expect(screen.getByText('正在修改与核对')).toBeInTheDocument();
});
it('keeps rechecks readable before critic results exist, without implying success', () => {
  const view = render(
    <RevisionReceipt
      run={{ ...run, status: 'running', result: { ...run.result!, criticReviews: null } }}
    />,
  );
  expect(screen.getByText('正在修改与核对')).toBeVisible();
  expect(screen.queryByText('修改已核对，待你确认')).not.toBeInTheDocument();
  view.rerender(
    <RevisionReceipt run={{ ...run, result: { ...run.result!, criticReviews: null } }} />,
  );
  expect(screen.getByText('尚未核对修改要求')).toBeVisible();
});
