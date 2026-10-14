import { expect, it, vi } from 'vitest';
import { resolveConflict } from './conflict';
const base = {
  choice: 'manuscript' as const,
  isDialogueLie: true,
  reason: '角色故意隐瞒',
  draftVersion: 3,
  branchId: 'main',
};
it('retains dialogue lie and human reason in conflict resolution', async () => {
  const send = vi.fn().mockResolvedValue({});
  await resolveConflict(send, base, false);
  expect(send).toHaveBeenCalledWith(base);
});
it('refuses stale conflict decisions before network mutation', async () => {
  const send = vi.fn();
  await expect(resolveConflict(send, base, true)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it('requires a meaningful reason', async () => {
  const send = vi.fn();
  await expect(resolveConflict(send, { ...base, reason: ' ' }, false)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
