import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { bookOverview } from '@/mocks/library/overview';
import OverviewChapters from './components/OverviewChapters';
import OverviewContext from './components/OverviewContext';
import OverviewQuality from './components/OverviewQuality';

it('keeps unconfirmed world, style and outline candidates out of the official overview', () => {
  const book = structuredClone(bookOverview('project-zhuoliu')!);
  book.confirmed = { direction: false, world: false, style: false, outline: false };
  book.bible.characters[0].name = '待确认人物不可显示';
  book.bible.style.anchorText = '待确认文风不可显示';
  book.chapters[0].title = '待确认章节不可显示';
  render(
    <>
      <OverviewContext book={book} onPrepare={vi.fn()} onChapter={vi.fn()} />
      <OverviewChapters book={book} onPrepare={vi.fn()} onChapter={vi.fn()} />
    </>,
  );
  expect(screen.queryByText('待确认人物不可显示')).not.toBeInTheDocument();
  expect(screen.queryByText('待确认文风不可显示')).not.toBeInTheDocument();
  expect(screen.queryByText('待确认章节不可显示')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认大纲' })).toBeInTheDocument();
});

it('filters overdue foreshadows and locates the planted segment', async () => {
  const book = structuredClone(bookOverview('project-zhuoliu')!);
  const onChapter = vi.fn();
  book.confirmed.world = true;
  const overdue = book.bible.foreshadows.find((item) => item.overdue && item.status === 'open')!;
  render(<OverviewContext book={book} onPrepare={vi.fn()} onChapter={onChapter} />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '筛选伏笔' }), 'overdue');
  await userEvent.click(screen.getByRole('button', { name: new RegExp(overdue.title) }));
  expect(onChapter).toHaveBeenCalledWith(overdue.plantedChapter, overdue.plantedSegment);
  for (const item of book.bible.foreshadows.filter(
    (item) => !item.overdue || item.status !== 'open',
  )) {
    expect(screen.queryByText(item.title)).not.toBeInTheDocument();
  }
});

it('shows aggregate hard blockers even when no averaged quality metrics exist', async () => {
  const book = structuredClone(bookOverview('project-zhuoliu')!);
  const onChapter = vi.fn();
  book.quality.items = [];
  book.quality.blockers = ['全书仍有未解决的硬伤'];
  book.worstFinding = {
    severity: 'P0',
    reason: '角色提前知道秘密',
    chapterId: 'ch7',
    segmentId: 'ch7-s2',
  };
  render(<OverviewQuality book={book} onReports={vi.fn()} onChapter={onChapter} />);
  expect(screen.getByText('全书仍有未解决的硬伤')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /第 7 章，AI 味/ }));
  expect(onChapter).toHaveBeenCalledWith('ch7');
});
