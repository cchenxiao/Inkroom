import { Sparkles } from 'lucide-react';
import { useUIStore } from '@/shared/lib/ui-store';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
/** 流式输出独立于 TipTap 文档，只订阅当前段的候选事件。 */
export function StreamingCandidate({ segmentId, runId }: { segmentId: string; runId: string }) {
  const delta = useUIStore((s) =>
    [...s.events]
      .reverse()
      .find((e) => e.runId === runId && e.type === 'draft.delta' && e.data.segmentId === segmentId),
  );
  const live = useUIStore(
    (s) => [...s.events].reverse().find((e) => e.runId === runId)?.data.run?.status === 'running',
  );
  if (!delta) return null;
  return (
    <aside className={`streaming-candidate ${live ? 'is-streaming' : ''}`} aria-live="polite">
      <span>
        <Sparkles size={13} />
        {live ? m.streaming : m.streamReady}
      </span>
      <p>
        {delta.data.text}
        {live && <i className="stream-cursor" />}
      </p>
    </aside>
  );
}
