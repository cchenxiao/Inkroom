import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { BackendRun } from '@/features/prepare/types/backend';
import { ReviewFailure } from './review-failure';
const run = {
  status: 'failed',
  draftVersion: 2,
  planning: { mode: 'chapter' },
  result: {
    criticReviews: [
      { critic: 'ai_taste', draftVersion: 2, status: 'failed', failureCode: 'canceled' },
      {
        critic: 'hard_consistency',
        draftVersion: 2,
        status: 'failed',
        failureCode: 'model_truncated',
        error: 'private provider detail',
      },
    ],
  },
} as unknown as BackendRun;
it('explains the root failure, hides raw errors and retries only on explicit click', async () => {
  const retry = vi.fn();
  render(<ReviewFailure run={run} onRetry={retry} disabled={false} />);
  expect(screen.getByText(/达到输出上限/)).toBeInTheDocument();
  expect(screen.queryByText(/private provider/)).not.toBeInTheDocument();
  expect(retry).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '保留正文，重新检查整章' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it('blocks retry while editing and never shows old or active failures', async () => {
  const retry = vi.fn();
  const view = render(<ReviewFailure run={run} onRetry={retry} disabled />);
  await userEvent.click(screen.getByRole('button'));
  expect(retry).not.toHaveBeenCalled();
  view.rerender(
    <ReviewFailure run={{ ...run, draftVersion: 3 }} onRetry={retry} disabled={false} />,
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  view.rerender(
    <ReviewFailure run={{ ...run, status: 'running' }} onRetry={retry} disabled={false} />,
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('does not crash or invent a completed check when failure precedes critic creation', () => {
  const view = render(
    <ReviewFailure
      run={{ ...run, result: { ...run.result!, criticReviews: null } }}
      disabled={false}
      onRetry={vi.fn()}
    />,
  );
  expect(view.container).toBeEmptyDOMElement();
});

it('explains an unmatched author-check quote and preserves the successful parallel check', async () => {
  const retry = vi.fn();
  const broken = {
    ...run,
    id: 'diagnostic-run',
    error: '运行未完成，保留最后成功落库的稿本',
    result: {
      ...run.result!,
      criticReviews: [
        {
          critic: 'hard_consistency',
          draftVersion: 2,
          status: 'failed',
          findings: [],
          failureCode: 'invalid_content',
          error:
            'consistency critic: invalid_content: author assessment quote must exist in target',
        },
        { critic: 'ai_taste', draftVersion: 2, status: 'completed', findings: [] },
      ],
    },
  };
  const view = render(
    <ReviewFailure run={broken} disabled disabledReason="请先处理未发送要求" onRetry={retry} />,
  );
  expect(screen.getByText('一致性审核未完成')).toBeInTheDocument();
  expect(screen.getByText(/在本次目标正文中找不到原句/)).toBeInTheDocument();
  expect(screen.getByText(/语言审查已完成/)).toBeInTheDocument();
  expect(screen.queryByText(/运行未完成，保留最后/)).not.toBeInTheDocument();
  expect(screen.queryByText(/author assessment quote/)).not.toBeInTheDocument();
  expect(screen.getByText('请先处理未发送要求')).toBeVisible();
  await userEvent.click(screen.getByRole('button'));
  expect(retry).not.toHaveBeenCalled();
  view.rerender(<ReviewFailure run={broken} disabled={false} onRetry={retry} />);
  await userEvent.click(screen.getByRole('button'));
  expect(retry).toHaveBeenCalledTimes(1);
});
