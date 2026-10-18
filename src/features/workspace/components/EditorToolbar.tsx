import { AlignLeft, CheckCheck, Focus, Highlighter, MessageSquare } from 'lucide-react';
import { Tooltip } from '@/shared/ui';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
import { studio } from '@/shared/lib/messages-studio';
export type EditorMode = 'editor' | 'comments' | 'final';
/** Shared by demo and real data. No API or alternate visual treatment. */
export function EditorToolbar({
  title,
  pov,
  tone,
  mode,
  onMode,
  heatmap,
  onHeatmap,
  focus,
  onFocus,
  commentCount = 0,
  liveWriting = false,
}: {
  title?: string;
  pov: string;
  tone?: string;
  mode: EditorMode;
  onMode: (mode: EditorMode) => void;
  heatmap: boolean;
  onHeatmap: () => void;
  focus: boolean;
  onFocus: () => void;
  commentCount?: number;
  liveWriting?: boolean;
}) {
  return (
    <header className="manuscript-toolbar">
      <div className="manuscript-context" title={`${title ?? ''} · ${pov}`}>
        <span>{title}</span>
        <span>
          {studio.pov} · {pov}
        </span>
        <span className="rhythm-label">{tone}</span>
      </div>
      <div className="manuscript-tabs" role="tablist" aria-label={m.editor}>
        {(
          [
            ['editor', AlignLeft, m.editor],
            ['comments', MessageSquare, liveWriting ? '审查标记' : m.comments],
            ['final', CheckCheck, liveWriting ? '净读' : m.final],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => onMode(value)}
          >
            <Icon size={14} />
            {label}
            {value === 'comments' && commentCount > 0 && (
              <span className="tab-count">{commentCount}</span>
            )}
          </button>
        ))}
      </div>
      <div className="manuscript-tools">
        <Tooltip content={m.heatmapHint}>
          <button
            className={heatmap ? 'active' : ''}
            aria-pressed={heatmap}
            aria-label={m.heatmap}
            onClick={onHeatmap}
          >
            <Highlighter size={14} />
            <span>{m.heatmap}</span>
          </button>
        </Tooltip>
        <Tooltip content={focus ? m.exitFocus : m.focus}>
          <button aria-label={focus ? m.exitFocus : m.focus} aria-pressed={focus} onClick={onFocus}>
            <Focus size={15} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
