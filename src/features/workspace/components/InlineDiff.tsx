import { useEffect, useState } from 'react';
import type { RevisionPatch } from '@/types/domain';
import { sentenceDiff } from '@/shared/lib/diff';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
export interface InlineDiffProps {
  patch: RevisionPatch;
  currentVersion: number;
  onApply: (ids: string[]) => void;
  onDiscard: () => void;
  busy?: boolean;
  stale?: boolean;
}
export function InlineDiff({
  patch,
  currentVersion,
  onApply,
  onDiscard,
  busy = false,
  stale = false,
}: InlineDiffProps) {
  const [accepted, setAccepted] = useState(() =>
    patch.sentences.filter((s) => s.status !== 'rejected').map((s) => s.id),
  );
  const invalid = stale || currentVersion !== patch.draftVersion || patch.status !== 'pending';
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === 'Enter' &&
        !invalid &&
        !busy &&
        accepted.length
      ) {
        event.preventDefault();
        onApply(accepted);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [accepted, invalid, busy, onApply]);
  return (
    <section className="inline-diff" aria-label={m.candidate}>
      <div className="diff-heading">
        <div>
          <span className="ws-eyebrow">
            {m.candidate} · v{patch.draftVersion}
          </span>
          <p>{m.candidateHint}</p>
        </div>
      </div>
      {invalid && (
        <p role="alert" className="diff-stale">
          {m.outdated}
        </p>
      )}
      {patch.sentences.map((s, i) => (
        <div
          key={s.id}
          className={`sentence-change ${accepted.includes(s.id) ? 'is-accepted' : 'is-rejected'}`}
        >
          <div className="sentence-number">{String(i + 1).padStart(2, '0')}</div>
          <div className="sentence-body">
            <div className="sentence-text">
              {sentenceDiff(s.oldText, s.newText).map((part, j) =>
                part.kind === 'insert' ? (
                  <ins key={j}>{part.text}</ins>
                ) : part.kind === 'delete' ? (
                  <del key={j}>{part.text}</del>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )}
            </div>
            <div className="sentence-actions">
              <button
                type="button"
                aria-label={m.sentence(i + 1, true)}
                aria-pressed={accepted.includes(s.id)}
                disabled={invalid || busy}
                onClick={() => setAccepted((v) => (v.includes(s.id) ? v : [...v, s.id]))}
              >
                {m.accept}
              </button>
              <button
                type="button"
                aria-label={m.sentence(i + 1, false)}
                aria-pressed={!accepted.includes(s.id)}
                disabled={invalid || busy}
                onClick={() => setAccepted((v) => v.filter((id) => id !== s.id))}
              >
                {m.reject}
              </button>
            </div>
          </div>
        </div>
      ))}
      <div className="diff-footer">
        <button className="ws-text-button" disabled={busy} onClick={onDiscard}>
          {m.discard}
        </button>
        <span>{m.shortcut}</span>
        <button
          className="ws-primary"
          disabled={invalid || busy || accepted.length === 0}
          onClick={() => onApply(accepted)}
        >
          {m.apply}
        </button>
      </div>
    </section>
  );
}
