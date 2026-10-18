import type { LiveBook } from '@/types/domain/live-book';
import { liveWorkspacePath, livePreparePath } from '@/shared/lib/writing-mode';
export { livePreparePath } from '@/shared/lib/writing-mode';
export function nextBookPath(b: LiveBook) {
  return b.nextSection || !b.currentChapterId
    ? livePreparePath(b.nextSection || 'outline', b.currentChapterId || undefined)
    : liveWorkspacePath(b.currentChapterId, b.nextStage);
}
