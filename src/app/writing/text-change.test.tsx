import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { TextChange } from './text-change';
import { savedChanges } from './saved-changes';
import type { BackendRun } from '@/features/prepare/types/backend';

it('shows deletion/insertion and switches between exact old and new text', async () => {
  const view = render(<TextChange before="窗台上的抹布还在。" after="窗台上空着。" />);
  expect(view.container.querySelector('del')).toHaveTextContent('的抹布还在');
  expect(view.container.querySelector('ins')).toHaveTextContent('空着');
  await userEvent.click(screen.getByRole('button', { name: '修改前' }));
  expect(screen.getByLabelText('修改前正文')).toHaveTextContent('窗台上的抹布还在。');
  await userEvent.click(screen.getByRole('button', { name: '修改后' }));
  expect(screen.getByLabelText('修改后正文')).toHaveTextContent('窗台上空着。');
});
it('keeps pure deletions visible and distinguishes empty text from a failed load', async () => {
  const view = render(<TextChange before="重复一句。" after="" />);
  expect(view.container.querySelector('del')).toHaveTextContent('重复一句。');
  await userEvent.click(screen.getByRole('button', { name: '修改后' }));
  expect(screen.getByLabelText('修改后正文')).toHaveTextContent('（无文字）');
});
it('recovers an exact legacy scoped diff without slicing by UTF-16 offsets', () => {
  const run = {
    id: 'run',
    status: 'waiting_human',
    draftVersion: 6,
    result: {
      revisions: [],
      segments: [{ id: 's', text: '🙂前。窗台上空着。后文。' }],
      authorRequest: { segmentId: 's', original: '🙂前。抹布还在。后文。', start: 3, end: 8 },
      context: {},
    },
  } as unknown as BackendRun;
  expect(savedChanges(run)[0]).toMatchObject({ before: '抹布还在。', after: '窗台上空着。' });
  expect(savedChanges({ ...run, status: 'running' })).toEqual([]);
  run.result!.revisions = [
    {
      kind: 'local_edit',
      round: 0,
      fromVersion: 6,
      toVersion: 7,
      patches: [
        {
          findingId: 'p',
          segmentId: 's',
          oldText: '空着',
          newText: '没有东西',
          reason: '作者修改',
        },
      ],
    },
  ];
  run.result!.findingChanges = [];
  expect(savedChanges(run)[0]).toMatchObject({
    before: '空着',
    after: '没有东西',
    label: '修改对照 · v6 → v7',
  });
  expect(savedChanges({ ...run, draftVersion: 8 })[0].current).toBe(false);
});
