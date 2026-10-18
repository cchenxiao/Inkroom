import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SelectionRewritePreview } from './selection-rewrite-preview';
const proposal = {
  id: 'p',
  findingId: '',
  draftVersion: 3,
  request: {
    segmentId: 's',
    original: '甲🙂开门。乙等着。',
    start: 2,
    end: 4,
    instruction: '改为敲门',
    preview: true,
  },
  replacement: '敲门',
};
describe('author-selected prose preview', () => {
  it('shows only the pinned selection, and applies that preview explicitly', async () => {
    const apply = vi.fn().mockResolvedValue(true),
      discard = vi.fn();
    render(
      <SelectionRewritePreview
        proposal={proposal}
        busy={false}
        onApply={apply}
        onDiscard={discard}
      />,
    );
    expect(screen.getByLabelText('文字差异').querySelector('del')).toHaveTextContent('开');
    expect(screen.getByLabelText('文字差异').querySelector('ins')).toHaveTextContent('敲');
    fireEvent.click(screen.getByRole('button', { name: '修改前' }));
    expect(screen.getByLabelText('修改前正文')).toHaveTextContent('开门');
    fireEvent.click(screen.getByRole('button', { name: '修改后' }));
    expect(screen.getByLabelText('修改后正文')).toHaveTextContent('敲门');
    expect(screen.queryByText(proposal.request.original)).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '应用选区修改' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith('p'));
    expect(discard).not.toHaveBeenCalled();
  });
  it('discards without applying and keeps errors visible for retry', async () => {
    const apply = vi.fn(),
      discard = vi.fn().mockResolvedValue(false);
    render(
      <SelectionRewritePreview
        proposal={proposal}
        busy={false}
        onApply={apply}
        onDiscard={discard}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '放弃这次预览' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('预览已保留'));
    expect(discard).toHaveBeenCalledWith('p');
    expect(apply).not.toHaveBeenCalled();
  });
});

it('names the whole-beat scope and exposes apply before long comparison content', () => {
  const whole = {
    ...proposal,
    request: { ...proposal.request, start: 0, end: Array.from(proposal.request.original).length },
  };
  render(
    <SelectionRewritePreview proposal={whole} busy={false} onApply={vi.fn()} onDiscard={vi.fn()} />,
  );
  const apply = screen.getByRole('button', { name: '应用到本段候选稿' });
  expect(
    apply.compareDocumentPosition(screen.getByLabelText('文字差异')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText(/只替换当前情节段/)).toBeVisible();
});
