import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import BackendRunFlow from './components/BackendRunFlow';
import type { BackendRun } from './types/backend';

const run: BackendRun = {
  id: 'private-run-id',
  chapterId: 'chapter-id',
  branchId: 'main',
  draftVersion: 2,
  status: 'committed',
  currentNode: 'commit',
  commitId: 'commit-id',
  reviseRound: 0,
  maxRounds: 2,
  tokens: 100,
  elapsedMs: 1,
  nodes: [],
  eventSequence: 23,
  activeRoles: [],
  canResume: false,
  baseDraftVersion: 1,
  createdAt: '2026-10-16',
  allowLocalRewrite: false,
  scenario: '',
  autoRevise: false,
  provider: 'test',
  model: 'test',
};
it('shows readable progress without shrinking the whole graph or treating unused branches as passed', async () => {
  render(<BackendRunFlow run={run} title="钥匙与半句" />);
  expect(screen.getByRole('heading', { name: '钥匙与半句 · 候选 v2' })).toBeVisible();
  const steps = screen.getAllByRole('listitem');
  expect(within(steps[3]).getByText('本次未执行')).toBeVisible();
  expect(within(steps[4]).getByText('已完成')).toBeVisible();
  expect(within(steps[5]).getByText('已完成')).toBeVisible();
  expect(screen.getByText('private-run-id')).not.toBeVisible();
  await userEvent.click(screen.getByText('技术详情（排查用）'));
  expect(screen.getByText('private-run-id')).toBeVisible();
});
it('shows a stopped step as unfinished and never exposes an unknown backend node as its name', () => {
  render(
    <BackendRunFlow
      run={{ ...run, status: 'failed', currentNode: 'future_internal_step', commitId: undefined }}
    />,
  );
  expect(screen.getByText('进度停在：等待流程状态更新')).toBeVisible();
  expect(screen.getByText('future_internal_step')).not.toBeVisible();
});
