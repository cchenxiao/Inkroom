import type { AuthorRewrite } from '@/features/prepare/types/backend';
export function rewriteRequest(
  segment: { id: string; text: string },
  instruction: string,
  quote?: string,
): AuthorRewrite {
  const start = quote ? segment.text.indexOf(quote) : 0;
  if (start < 0 || (quote && segment.text.indexOf(quote, start + 1) >= 0))
    throw new Error('选中的文字不存在或在本段多次出现，请扩大选区后重试。');
  return {
    segmentId: segment.id,
    original: segment.text,
    start: Array.from(segment.text.slice(0, start)).length,
    end: Array.from(segment.text.slice(0, start) + (quote || segment.text)).length,
    instruction,
  };
}
