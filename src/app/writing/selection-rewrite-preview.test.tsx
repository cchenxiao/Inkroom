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
    expect(screen.getByText('开门', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('敲门', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(proposal.request.original)).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认替换选中文字' }));
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
