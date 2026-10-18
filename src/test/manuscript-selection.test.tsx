import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { WritingManuscript } from '@/features/workspace/components/WritingManuscript';
import type { Finding, Segment } from '@/types/domain';

const parts = ['窗前', '门后'].map((title, i) => ({
  id: `beat-${i}`,
  title,
  accepted: true,
  segments: [
    {
      id: `segment-${i}`,
      text: `${title}传来轻响。`,
      version: 1,
      order: i + 1,
      pov: '',
      charactersPresent: [],
      entitiesMentioned: [],
      foreshadowIds: [],
      styleStats: { sentenceLengths: [], dialogueRatio: 0, aiTaste: 0, repeatedPhrases: [] },
    } as unknown as Segment,
  ],
}));
function Manuscript({
  dirty = false,
  loading = false,
  findings = [],
  selectedFinding = null,
}: {
  dirty?: boolean;
  loading?: boolean;
  findings?: Finding[];
  selectedFinding?: string | null;
}) {
  const [activeBeat, select] = useState(parts[0].id);
  return (
    <WritingManuscript
      parts={loading ? parts.map((p) => ({ ...p, segments: [], loading: true })) : parts}
      activeBeat={activeBeat}
      title="第一章"
      pov=""
      findings={findings}
      selectedFinding={selectedFinding}
      editable={false}
      localText={{}}
      dirty={dirty}
      blocked=""
      busy={false}
      onChange={vi.fn()}
      onSelectBeat={select}
      onFinding={vi.fn()}
      onSelection={vi.fn()}
      onSave={vi.fn()}
      onStart={vi.fn()}
      onReview={vi.fn()}
      startDisabled={false}
      onRewrite={vi.fn()}
    />
  );
}
it('selects readonly prose with a persistent current marker without changing its text', () => {
  render(<Manuscript />);
  const second = screen.getByRole('region', { name: '门后' });
  fireEvent.click(screen.getByText('门后传来轻响。'));
  expect(second).toHaveAttribute('aria-current', 'true');
  expect(within(second).getByRole('button', { name: '门后' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(within(second).getByText('当前段')).toBeVisible();
  expect(screen.getByText('已选：门后')).toBeVisible();
  expect(screen.getByText('窗前传来轻响。')).toBeVisible();
});
it('does not switch the active beat while selecting a quote or while edits are unsaved', () => {
  const selection = vi
    .spyOn(window, 'getSelection')
    .mockReturnValue({ toString: () => '门后' } as Selection);
  const view = render(<Manuscript />);
  fireEvent.click(screen.getByText('门后传来轻响。'));
  expect(screen.getByRole('region', { name: '窗前' })).toHaveAttribute('aria-current', 'true');
  selection.mockRestore();
  view.rerender(<Manuscript dirty />);
  fireEvent.click(screen.getByText('门后传来轻响。'));
  expect(screen.getByRole('region', { name: '窗前' })).toHaveAttribute('aria-current', 'true');
});

it('does not jump back to a finding on polling or unrelated draft updates', () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  const finding = {
    id: 'review-1',
    segmentId: 'segment-0',
    quote: '窗前',
    reason: '核对动作',
    severity: 'P3',
  } as Finding;
  const view = render(<Manuscript findings={[finding]} selectedFinding="review-1" />);
  scroll.mockClear();
  // Polling recreates findings; reading position must remain under author control.
  view.rerender(<Manuscript findings={[{ ...finding }]} selectedFinding="review-1" />);
  expect(scroll).not.toHaveBeenCalled();
  view.rerender(
    <Manuscript findings={[{ ...finding, segmentId: 'segment-1' }]} selectedFinding="review-1" />,
  );
  expect(scroll).not.toHaveBeenCalled();
  view.rerender(
    <Manuscript
      findings={[{ ...finding, id: 'review-2', segmentId: 'segment-1' }]}
      selectedFinding="review-2"
    />,
  );
  expect(scroll).toHaveBeenCalledTimes(1);
  scroll.mockRestore();
});

it('restores a chapter on one loading surface rather than flashing empty manuscripts', () => {
  const view = render(<Manuscript loading />);
  expect(screen.getByRole('status', { name: '正在读取章节正文' })).toBeVisible();
  expect(screen.queryByText('这一段还没有正文')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '生成本段' })).not.toBeInTheDocument();
  expect(screen.queryByText('稿件已保存')).not.toBeInTheDocument();
  view.rerender(<Manuscript />);
  expect(screen.queryByRole('status', { name: '正在读取章节正文' })).not.toBeInTheDocument();
  expect(screen.getByText('窗前传来轻响。')).toBeVisible();
  expect(screen.getByText('门后传来轻响。')).toBeVisible();
});
