import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { usePanelDialog } from '@/shared/lib/use-panel-dialog';
import { DangerButton } from '@/shared/ui';

it('releases the manuscript after closing a drawer and retains its unsent draft', async () => {
  const confirm = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    const panel = useRef<HTMLElement>(null);
    usePanelDialog(panel, open, () => setOpen(false));
    return (
      <>
        <main>
          <button onClick={() => setOpen(true)}>打开审核</button>
        </main>
        <aside ref={panel} role="dialog" aria-label="审核" tabIndex={-1} hidden={!open}>
          <textarea aria-label="修改要求" />
          <DangerButton title="确认丢弃？" description="请确认" onConfirm={confirm}>
            丢弃
          </DangerButton>
          <button onClick={() => setOpen(false)}>关闭审核</button>
        </aside>
      </>
    );
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: '打开审核' }));
  expect(screen.queryByRole('main')).not.toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox'), '保留这一句。');
  await userEvent.click(screen.getByRole('button', { name: '丢弃' }));
  await userEvent.click(screen.getByRole('button', { name: '确认丢弃' }));
  expect(confirm).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: '关闭审核' }));
  expect(screen.getByRole('main')).not.toHaveAttribute('aria-hidden');
  expect(screen.getByRole('main').inert).toBeFalsy();
  await userEvent.click(screen.getByRole('button', { name: '打开审核' }));
  expect(screen.getByRole('textbox')).toHaveValue('保留这一句。');
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: '打开审核' })).toHaveFocus();
});
