import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server, resetDB } from '@/mocks/node';
import { useUIStore } from '@/shared/lib/ui-store';
import ReportsPage from './index';
vi.mock('@/shared/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/shared/ui')>();
  return {
    ...original,
    Chart: ({ option }: { option: unknown }) => (
      <div data-testid="chart">{JSON.stringify(option)}</div>
    ),
  };
});
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  resetDB();
  useUIStore.setState({ chapterId: 'ch7', branchId: 'main', stale: false });
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('uses the supplied fractional range and names style distance accurately', async () => {
  mount();
  const charts = await screen.findAllByTestId('chart');
  const option = JSON.parse(charts[0].textContent!);
  expect(option.yAxis.max).toBe(1);
  expect(option.series[0].name).toBe('文风距离');
  expect(option.series[0].data.some((value: number) => value > 0 && value < 1)).toBe(true);
});
it('shows chapter structure and routes an overdue foreshadow to its planted evidence', async () => {
  mount();
  await screen.findByRole('heading', { name: '章节状态与结构' });
  expect(screen.getByRole('button', { name: '打开章节 夜谈' })).toBeInTheDocument();
  const section = await screen.findByRole('region', { name: '逾期伏笔' });
  expect(within(section).getByText('铜扣的三道划痕')).toBeInTheDocument();
  await userEvent.click(within(section).getByRole('button', { name: '定位原文 铜扣的三道划痕' }));
  expect(useUIStore.getState().chapterId).toBe('ch2');
  expect(useUIStore.getState().selectedSegment).toBe('ch2-s2');
});
it('opens the actual sample evidence from the experiment table', async () => {
  mount();
  await screen.findAllByTestId('chart');
  await userEvent.click(screen.getByRole('tab', { name: '对照实验' }));
  await userEvent.click((await screen.findAllByRole('button', { name: '知识越界 · P0' }))[0]);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('他认出了那个从未见过的人')).toBeInTheDocument();
});
