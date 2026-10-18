import { useMemo, useState } from 'react';
import { sentenceDiff } from '@/shared/lib/diff';
import './text-change.css';

/** Same semantic diff as InlineDiff; only the owner controls persistence. */
export function TextChange({ before, after }: { before: string; after: string }) {
  const [mode, setMode] = useState<'diff' | 'before' | 'after'>('diff');
  const [expanded, setExpanded] = useState(false);
  const parts = useMemo(() => sentenceDiff(before, after), [before, after]);
  return (
    <div className="text-change">
      <div role="group" aria-label="修改对照视图" className="text-change-tabs">
        {(['diff', 'before', 'after'] as const).map((id, i) => (
          <button type="button" key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>
            {['差异', '修改前', '修改后'][i]}
          </button>
        ))}
      </div>
      {mode === 'diff' && <small>红色删除线：删除 · 绿色下划线：新增</small>}
      <div
        className="sentence-text text-change-content"
        aria-label={mode === 'diff' ? '文字差异' : mode === 'before' ? '修改前正文' : '修改后正文'}
      >
        {mode !== 'diff'
          ? (mode === 'before' ? before : after) || '（无文字）'
          : parts.map((part, i) =>
              part.kind === 'insert' ? (
                <ins key={i}>{part.text}</ins>
              ) : part.kind === 'delete' ? (
                <del key={i}>{part.text}</del>
              ) : (
                <span key={i}>
                  {!expanded && part.text.length > 180
                    ? `${part.text.slice(0, 60)}\n…（未改文字已折叠）…\n${part.text.slice(-60)}`
                    : part.text}
                </span>
              ),
            )}
      </div>
      {before === after && <p className="muted">正文没有变化。</p>}
      {mode === 'diff' && parts.some((p) => p.kind === 'equal' && p.text.length > 180) && (
        <button type="button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '折叠未改文字' : '展开全部上下文'}
        </button>
      )}
    </div>
  );
}
