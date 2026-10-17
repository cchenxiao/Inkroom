import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BackendRun } from '@/features/prepare/types/backend';
import { ReviewProgress } from '@/features/prepare/components/review-progress';
const start = '2026-10-17T10:00:00Z';
const run = {
  status: 'running',
  activeRoles: ['hard_consistency'],
  activeCalls: [
    {
      number: 1,
      role: 'hard_consistency',
      activity: 'consistency',
      phase: 'started',
      startedAt: start,
      timeoutMs: 90000,
    },
  ],
} as BackendRun;
afterEach(() => vi.useRealTimers());
it('restores elapsed waiting after refresh and does not invent completion or retry', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T10:01:20Z'));
  const view = render(<ReviewProgress run={run} />);
  expect(screen.getByText('已等待 80 秒')).toBeInTheDocument();
  expect(screen.getByText('核对事实与设定')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByText('已等待 90 秒')).toBeInTheDocument();
  expect(screen.getByText('等待服务确认检查结果')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<ReviewProgress run={{ ...run, status: 'failed' }} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('shows only active stages and hides finished parallel calls', () => {
  render(
    <ReviewProgress
      run={{
        ...run,
        activeCalls: [
          { ...run.activeCalls![0], activity: 'continuity_objects' },
          {
            ...run.activeCalls![0],
            number: 2,
            activity: 'continuity_characters',
            phase: 'finished',
          },
        ],
      }}
    />,
  );
  expect(screen.getByText('核对物件与数量衔接')).toBeInTheDocument();
  expect(screen.queryByText('核对人物与动作衔接')).not.toBeInTheDocument();
});
it('supports old snapshots without inventing a start time', () => {
  const view = render(<ReviewProgress run={{ ...run, activeCalls: undefined }} />);
  expect(screen.getByText('核对事实与设定')).toBeInTheDocument();
  expect(screen.queryByText(/已等待/)).not.toBeInTheDocument();
  view.rerender(<ReviewProgress run={{ ...run, status: 'waiting_human' }} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
