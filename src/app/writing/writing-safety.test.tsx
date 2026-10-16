import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import { PendingWritingProvider, useWritingLocked } from '@/shared/lib/pending-writing';
import { useAuthorDraft } from './author-draft';
import { useWritingActions } from '@/features/prepare/hooks/useWritingActions';
import { trialApi } from '@/features/prepare/api/backend';
import type { BackendRun } from '@/features/prepare/types/backend';

it('retains unsent instructions, blocks navigation, and invalidates them on a new version', async () => {
  sessionStorage.clear();
  function Probe() {
    const [version, setVersion] = useState(1);
    const draft = useAuthorDraft('instruction:test-run', version);
    const locked = useWritingLocked();
    return (
      <>
        <textarea
          aria-label="指令"
          value={draft.texts.instruction ?? ''}
          onChange={(e) => draft.change('instruction', e.target.value)}
        />
        <button disabled={locked}>切换段落</button>
        <button onClick={() => setVersion((v) => v + 1)}>外部版本更新</button>
        <button onClick={() => draft.remove('instruction')}>清除指令</button>
        <button disabled={draft.stale || !draft.dirty}>发送</button>
        <Link to="/library">作品库</Link>
      </>
    );
  }
  const view = render(
    <RouterProvider
      router={createMemoryRouter(
        [
          {
            path: '/workspace',
            element: (
              <PendingWritingProvider>
                <Probe />
              </PendingWritingProvider>
            ),
          },
          { path: '/library', element: <p>书架</p> },
        ],
        { initialEntries: ['/workspace'] },
      )}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('指令'), '保留事件结果，只修改措辞');
  expect(screen.getByRole('button', { name: '切换段落' })).toBeDisabled();
  await user.click(screen.getByRole('link', { name: '作品库' }));
  await screen.findByRole('dialog', { name: '离开当前编辑？' });
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await user.click(screen.getByRole('button', { name: '外部版本更新' }));
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  expect(screen.getByLabelText('指令')).toHaveValue('保留事件结果，只修改措辞');
  await user.click(screen.getByRole('button', { name: '清除指令' }));
  await user.type(screen.getByLabelText('指令'), '基于新版本重新批注');
  expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
  view.unmount();
  sessionStorage.clear();
});

it('resumes a persisted interrupted action with its original operation ID and version', async () => {
  const pendingAction = {
    id: 'original-operation',
    type: 'inline_edit' as const,
    draftVersion: 2,
    segmentId: 'segment',
    text: '已提交但中断的作者修改',
  };
  const run = { id: 'run', status: 'interrupted', draftVersion: 2, pendingAction } as BackendRun;
  const spy = vi.spyOn(trialApi, 'action').mockResolvedValue({ ...run, status: 'running' });
  function Probe() {
    const [version, setVersion] = useState(3);
    const actions = useWritingActions(run, version);
    return (
      <>
        <button onClick={() => setVersion(2)}>恢复匹配版本</button>
        <button disabled={!actions.resumable} onClick={actions.resume}>
          恢复修改
        </button>
      </>
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(screen.getByRole('button', { name: '恢复修改' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '恢复匹配版本' }));
  await user.click(screen.getByRole('button', { name: '恢复修改' }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith('run', pendingAction));
  view.unmount();
  client.clear();
  spy.mockRestore();
});
