import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { ContinuityOption } from './continuity-option';
it('defaults off and distinguishes the next choice from the frozen current run', async () => {
  function Example({ busy = false }: { busy?: boolean }) {
    const [checked, setChecked] = useState(false);
    return (
      <ContinuityOption checked={checked} onChange={setChecked} current={false} disabled={busy} />
    );
  }
  const view = render(<Example />);
  const toggle = screen.getByRole('checkbox', { name: '加强衔接检查 试用' });
  expect(toggle).not.toBeChecked();
  await userEvent.click(toggle);
  expect(toggle).toBeChecked();
  expect(screen.getByText('本轮：未开启 · 新选择尚未执行')).toBeInTheDocument();
  view.rerender(<Example busy />);
  expect(toggle).toBeDisabled();
  await userEvent.click(toggle);
  expect(toggle).toBeChecked();
});
