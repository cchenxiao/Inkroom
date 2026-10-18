import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QualitySummary } from './quality-summary';
import type { BackendRun } from '@/features/prepare/types/backend';
const run = {
  status: 'waiting_human',
  draftVersion: 3,
  result: {
    criticReviews: [
      {
        critic: 'ai_taste',
        draftVersion: 3,
        status: 'completed',
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
        draftVersion: 3,
        status: 'completed',
        continuity: [
          {
            segmentId: 's',
            status: 'conflict',
            openingQuote: '袋子放进柜里。',
            closingQuote: '袋子在桌上。',
            reason: '缺少取出的动作。',
          },
        ],
      },
    ],
  },
} as unknown as BackendRun;
it('shows deterministic length and collapsed evidence without implying approval', () => {
  render(<QualitySummary run={run} />);
  expect(screen.getByText(/篇幅偏长/)).toBeInTheDocument();
  expect(screen.getByText('衔接核对 · 1 段待处理')).toBeInTheDocument();
  expect(screen.getByText('缺少取出的动作。')).not.toBeVisible();
  expect(screen.getByText(/不会自动删字/)).toBeInTheDocument();
});
it('never displays old checks for a new draft, running task or unsaved edits', () => {
  const view = render(<QualitySummary run={{ ...run, draftVersion: 4 }} />);
  expect(screen.queryByLabelText('篇幅与衔接')).not.toBeInTheDocument();
  view.rerender(<QualitySummary run={run} dirty />);
  expect(screen.queryByLabelText('篇幅与衔接')).not.toBeInTheDocument();
  view.rerender(<QualitySummary run={{ ...run, status: 'running' }} />);
  expect(screen.queryByLabelText('篇幅与衔接')).not.toBeInTheDocument();
});
it('can show measured length after failed review without a successful continuity label', () => {
  render(<QualitySummary run={{ ...run, status: 'failed' }} />);
  expect(screen.getByText(/篇幅偏长/)).toBeInTheDocument();
  expect(screen.queryByText(/衔接核对/)).not.toBeInTheDocument();
});

it('prepares a single-beat length request only when explicitly clicked', async () => {
  const prepare = vi.fn();
  const beatRun = structuredClone(run);
  beatRun.result!.criticReviews![0].length!.scope = 'beat';
  render(<QualitySummary run={beatRun} onPrepareCondense={prepare} />);
  expect(prepare).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '填写精简本段的要求' }));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledWith(2400);
});
it('does not offer a single-beat shortcut for a chapter or unsaved manuscript', () => {
  const view = render(<QualitySummary run={run} onPrepareCondense={vi.fn()} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<QualitySummary run={run} dirty onPrepareCondense={vi.fn()} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('does not interpret missing critic results as a successful review', () => {
  const view = render(
    <QualitySummary run={{ ...run, result: { ...run.result!, criticReviews: null } }} />,
  );
  expect(view.container).toBeEmptyDOMElement();
});

it('shows version-bound review comparison without calling missing findings resolved', () => {
  const withComparison = {
    ...run,
    result: {
      ...run.result!,
      criticReviews: [],
      reviewComparison: { fromVersion: 2, toVersion: 3, added: 1, continued: 2, notRepeated: 3 },
    },
  };
  const view = render(<QualitySummary run={withComparison} />);
  expect(screen.getByText(/新增 1 条/)).toHaveTextContent('原引用仍有意见 2 条');
  expect(screen.getByText(/未再报出不等于作者确认已解决/)).toBeInTheDocument();
  view.rerender(<QualitySummary run={{ ...withComparison, draftVersion: 4 }} />);
  expect(screen.queryByText(/新增 1 条/)).not.toBeInTheDocument();
});
