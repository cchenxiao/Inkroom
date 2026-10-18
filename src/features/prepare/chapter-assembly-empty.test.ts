import { expect, it, vi } from 'vitest';
import { backendApi } from '@/shared/api/client';
import { assemblyApi } from './api/chapter-assembly';
it('normalizes the real unassembled chapter response before manuscript rendering', async () => {
  const post = vi
    .spyOn(backendApi, 'post')
    .mockResolvedValue({ ready: false, slots: null, history: null, draft: { parts: null } });
  try {
    const result = await assemblyApi.preview('new-chapter', {});
    expect(result.draft.parts.find((p) => p.beatId === 'b1')).toBeUndefined();
    expect(result.slots).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.ready).toBe(false);
  } finally {
    post.mockRestore();
  }
});
