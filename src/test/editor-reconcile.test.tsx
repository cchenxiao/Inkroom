import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReconcileDialog } from '@/features/workspace/components/ReconcileDialog';
import { seedDocuments } from '@/mocks/data/seed';
describe('explicit local-draft reconciliation', () => {
  it('shows both texts and only approves overwrite after an explicit author action', () => {
    const snapshot = seedDocuments().ch7;
    const confirm = vi.fn(),
      close = vi.fn();
    render(
      <ReconcileDialog
        snapshot={snapshot}
        drafts={{ 'ch7-s1': 'My unsaved draft' }}
        currentVersion={snapshot.chapter.draftVersion}
        onClose={close}
        onConfirm={confirm}
      />,
    );
    expect(screen.getByText(snapshot.segments[0].text)).toBeVisible();
    expect(screen.getByText('My unsaved draft')).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(close).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认采用本地草稿并保存' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
  it('blocks approval if the displayed server snapshot has since changed', () => {
    const snapshot = seedDocuments().ch7;
    const confirm = vi.fn();
    render(
      <ReconcileDialog
        snapshot={snapshot}
        drafts={{ 'ch7-s1': 'My unsaved draft' }}
        currentVersion={snapshot.chapter.draftVersion + 1}
        onClose={vi.fn()}
        onConfirm={confirm}
      />,
    );
    const button = screen.getByRole('button', { name: '确认采用本地草稿并保存' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
  });
});
