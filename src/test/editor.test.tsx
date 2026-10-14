import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineDiff } from '@/features/workspace/components/InlineDiff';
import type { RevisionPatch } from '@/types/domain';
const patch: RevisionPatch = {
  id: 'patch-1',
  findingId: 'finding-1',
  segmentId: 'seg-1',
  draftVersion: 3,
  origin: 'agent',
  status: 'pending',
  sentences: [
    { id: 's1', oldText: '雨停了。', newText: '雨还没停。', status: 'pending' },
    { id: 's2', oldText: '他走了。', newText: '他留了下来。', status: 'pending' },
  ],
};
describe('author-controlled sentence suggestions', () => {
  it('keeps the suggestion separate until the author applies accepted sentences', () => {
    const apply = vi.fn();
    render(<InlineDiff patch={patch} currentVersion={3} onApply={apply} onDiscard={vi.fn()} />);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '拒绝第 2 句' }));
    fireEvent.click(screen.getByRole('button', { name: '应用所选修改' }));
    expect(apply).toHaveBeenCalledWith(['s1']);
  });
  it('blocks application when the manuscript version changed', () => {
    const apply = vi.fn();
    render(<InlineDiff patch={patch} currentVersion={4} onApply={apply} onDiscard={vi.fn()} />);
    expect(screen.getByRole('button', { name: '应用所选修改' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText(/此建议基于旧版本/)).toBeInTheDocument();
  });
  it('can discard a suggestion without applying any text', () => {
    const apply = vi.fn(),
      discard = vi.fn();
    render(<InlineDiff patch={patch} currentVersion={3} onApply={apply} onDiscard={discard} />);
    fireEvent.click(screen.getByRole('button', { name: '放弃此建议' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
  });
});
