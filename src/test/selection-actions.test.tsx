import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SegmentEditor } from '@/features/workspace/editor/SegmentEditor';
import { DangerButton } from '@/shared/ui';
import type { Segment } from '@/types/domain';
const segment: Segment = {
  id: 'selected-segment',
  version: 3,
  order: 1,
  chapterId: 'ch',
  sceneId: 'scene',
  beatId: 'beat',
  text: '他放下钥匙。\n她没有回答。',
  pov: '',
  charactersPresent: [],
  entitiesMentioned: [],
  foreshadowIds: [],
  styleStats: { sentenceLengths: [], dialogueRatio: 0, aiTaste: 0, repeatedPhrases: [] },
};
it('opens author actions on readonly prose without editing the saved text', async () => {
  const select = vi.fn(),
    change = vi.fn();
  render(
    <SegmentEditor
      segment={segment}
      text={segment.text}
      findings={[]}
      editable={false}
      heatmap={false}
      onChange={change}
      onFocus={vi.fn()}
      onFinding={vi.fn()}
      onSelection={select}
      availableActions={['edit', 'instruct', 'rewrite', 'review']}
    />,
  );
  fireEvent.contextMenu(screen.getByTestId('editor-selected-segment'), {
    clientX: 120,
    clientY: 100,
  });
  const menu = screen.getByRole('menu', { name: '正文操作' });
  expect(within(menu).getByRole('menuitem', { name: '直接修改原文' })).toBeDisabled();
  await userEvent.click(within(menu).getByRole('menuitem', { name: '作者判断与审核' }));
  expect(select).toHaveBeenCalledWith({
    segmentId: segment.id,
    version: 3,
    action: 'review',
    quote: '',
  });
  expect(change).not.toHaveBeenCalled();
});
it('binds a selected readonly quote to its source version and dismisses with Escape', async () => {
  const select = vi.fn();
  const selection = vi.spyOn(window, 'getSelection');
  render(
    <SegmentEditor
      segment={segment}
      text={segment.text}
      findings={[]}
      editable={false}
      heatmap={false}
      onChange={vi.fn()}
      onFocus={vi.fn()}
      onFinding={vi.fn()}
      onSelection={select}
      availableActions={['instruct', 'rewrite', 'review']}
    />,
  );
  const node = screen.getByTestId('editor-selected-segment').querySelector('p')!.firstChild;
  selection.mockReturnValue({
    anchorNode: node,
    focusNode: node,
    toString: () => '他放下钥匙。',
  } as Selection);
  fireEvent.contextMenu(screen.getByTestId('editor-selected-segment'));
  await userEvent.click(screen.getByRole('menuitem', { name: '模型修改选中文字' }));
  expect(select).toHaveBeenCalledWith({
    segmentId: segment.id,
    version: 3,
    action: 'rewrite',
    quote: '他放下钥匙。',
  });
  fireEvent.contextMenu(screen.getByTestId('editor-selected-segment'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  selection.mockRestore();
});
it('requires a deliberate second action for a dangerous operation', async () => {
  const confirm = vi.fn();
  render(
    <DangerButton title="取消当前运行？" description="已保存的正文保留。" onConfirm={confirm}>
      取消运行
    </DangerButton>,
  );
  await userEvent.click(screen.getByRole('button', { name: '取消运行' }));
  expect(confirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(confirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '取消运行' }));
  await userEvent.click(screen.getByRole('button', { name: '确认取消运行' }));
  expect(confirm).toHaveBeenCalledOnce();
});
