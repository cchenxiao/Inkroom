import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { WritingManuscript } from '@/features/workspace/components/WritingManuscript';
import type { Segment } from '@/types/domain';

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
function Manuscript({ dirty = false }: { dirty?: boolean }) {
  const [activeBeat, select] = useState(parts[0].id);
  return (
    <WritingManuscript
      parts={parts}
      activeBeat={activeBeat}
      title="第一章"
      pov=""
      findings={[]}
      selectedFinding={null}
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
  expect(within(second).getByText('已选中')).toBeVisible();
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
