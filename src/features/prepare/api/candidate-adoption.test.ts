import { afterEach, expect, it, vi } from 'vitest';
import {
  adoptionBlock,
  adoptionLabel,
  adoptCandidate,
  type AdoptionOperation,
} from './candidate-adoption';
import { trialApi } from './backend';
import type { BackendRun } from '../types/backend';

const approved = {
  id: 'run',
  draftVersion: 2,
  inputDigest: 'digest',
  status: 'approved',
} as BackendRun;
const operation: AdoptionOperation = {
  kind: 'adopt',
  approval: { id: 'approve-once', type: 'approve', draftVersion: 2 },
  input: { id: 'commit-once', draftVersion: 2, inputDigest: 'digest', factsConfirmed: true },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('waits for asynchronous approval before adoption with the same frozen version', async () => {
  vi.useFakeTimers();
  const committed = { ...approved, status: 'committed', commitId: 'commit-once' } as BackendRun;
  vi.spyOn(trialApi, 'get')
    .mockResolvedValueOnce({ ...approved, status: 'waiting_human' })
    .mockResolvedValueOnce(approved)
    .mockResolvedValue(committed);
  const action = vi
    .spyOn(trialApi, 'action')
    .mockResolvedValue({ ...approved, status: 'running', pendingAction: operation.approval });
  const finalize = vi.spyOn(trialApi, 'finalize').mockResolvedValue({} as never);
  const task = adoptCandidate('run', operation);
  await vi.advanceTimersByTimeAsync(0);
  expect(finalize).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(await task).toEqual(committed);
  expect(action).toHaveBeenCalledWith('run', operation.approval);
  expect(finalize).toHaveBeenCalledWith('run', operation.input);
});

it('continues a lost approval response without resubmitting approval', async () => {
  vi.useFakeTimers();
  vi.spyOn(trialApi, 'get')
    .mockResolvedValueOnce({ ...approved, status: 'running', pendingAction: operation.approval })
    .mockResolvedValue(approved);
  const action = vi.spyOn(trialApi, 'action');
  const finalize = vi.spyOn(trialApi, 'finalize').mockResolvedValue({} as never);
  const task = adoptCandidate('run', operation);
  await vi.advanceTimersByTimeAsync(500);
  await task;
  expect(action).not.toHaveBeenCalled();
  expect(finalize).toHaveBeenCalledWith('run', operation.input);
});

it('retries an uncertain commit using the original commit ID and does not reapprove', async () => {
  vi.spyOn(trialApi, 'get').mockResolvedValue(approved);
  const action = vi.spyOn(trialApi, 'action');
  const finalize = vi
    .spyOn(trialApi, 'finalize')
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValue({} as never);
  await expect(adoptCandidate('run', operation)).rejects.toThrow('connection lost');
  await adoptCandidate('run', operation);
  expect(finalize.mock.calls).toEqual([
    ['run', operation.input],
    ['run', operation.input],
  ]);
  expect(action).not.toHaveBeenCalled();
});

it('refuses a newer manuscript or changed input instead of adopting unseen prose', async () => {
  const get = vi.spyOn(trialApi, 'get').mockResolvedValue({ ...approved, draftVersion: 3 });
  const finalize = vi.spyOn(trialApi, 'finalize');
  await expect(adoptCandidate('run', operation)).rejects.toThrow('正文版本已变化');
  get.mockResolvedValue({ ...approved, inputDigest: 'changed' });
  await expect(adoptCandidate('run', operation)).rejects.toThrow('正文版本已变化');
  expect(finalize).not.toHaveBeenCalled();
});

it('keeps backend approval and commit rejection reasons visible', async () => {
  const blocked = { ...approved, actionBlocks: { commit: '请先处理事实冲突' } };
  expect(adoptionBlock(blocked, 2)).toBe('请先处理事实冲突');
  expect(
    adoptionBlock(
      { ...blocked, status: 'waiting_human', actionBlocks: { approve: '证据校验未完成' } },
      2,
    ),
  ).toBe('证据校验未完成');
  vi.spyOn(trialApi, 'get').mockResolvedValue(blocked);
  const finalize = vi.spyOn(trialApi, 'finalize');
  await expect(adoptCandidate('run', operation)).rejects.toThrow('请先处理事实冲突');
  expect(finalize).not.toHaveBeenCalled();
});

it('blocks pending edits, old versions and dismissed or adopted candidates', () => {
  expect(adoptionBlock(approved, undefined)).toContain('读取');
  expect(adoptionBlock(approved, 3)).toContain('版本');
  expect(adoptionBlock({ ...approved, dismissed: true }, 2)).toContain('放弃');
  expect(adoptionBlock({ ...approved, commitId: 'done' }, 2)).toContain('已采用');
  expect(
    adoptionBlock({ ...approved, result: { reviewPending: true } as BackendRun['result'] }, 2),
  ).toContain('复审');
  expect(
    adoptionBlock({ ...approved, result: { findingProposal: {} } as BackendRun['result'] }, 2),
  ).toContain('预览');
});

it('labels the actual batch scope, never a single beat for a multi-beat commit', () => {
  expect(adoptionLabel(approved)).toBe('采用本段');
  expect(
    adoptionLabel({
      ...approved,
      planning: { mode: 'chapter', targetBeatIds: ['b1', 'b3'] } as BackendRun['planning'],
    }),
  ).toBe('采用本批 2 段');
});
