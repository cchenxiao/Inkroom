import { expect, it } from 'vitest';
import { rewriteRequest } from './rewrite-request';
it('pins exact Unicode offsets and source text, including emoji and paragraph boundaries', () => {
  const segment = { id: 's', text: '他🙂开门。\n她等着。' };
  expect(rewriteRequest(segment, '改为敲门', '开门')).toEqual({
    segmentId: 's',
    original: segment.text,
    start: 2,
    end: 4,
    instruction: '改为敲门',
  });
  expect(rewriteRequest(segment, '重写本段').end).toBe(Array.from(segment.text).length);
});
it('rejects missing and ambiguous selections instead of editing the wrong occurrence', () => {
  expect(() => rewriteRequest({ id: 's', text: '他说。他说。' }, '改写', '他说')).toThrow(
    '多次出现',
  );
  expect(() => rewriteRequest({ id: 's', text: '新文' }, '改写', '旧文')).toThrow('不存在');
});
