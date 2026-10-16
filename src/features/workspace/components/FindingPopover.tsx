import { X, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { Badge, Button } from '@/shared/ui';
import { workspaceMessages as m } from '@/shared/lib/messages-workspace';
import type { Finding } from '@/types/domain';
export function FindingPopover({
  finding,
  onSuggest,
  onIgnore,
  onClose,
  busy,
  disabled,
}: {
  finding: Finding;
  onSuggest: () => void;
  onIgnore: () => void;
  onClose: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <aside
      className={`finding-popover severity-${finding.critic === 'reader' ? 'p3' : finding.severity.toLowerCase()}`}
      aria-label={m.finding}
    >
      <header>
        <ShieldAlert size={16} />
        <Badge
          tone={
            finding.critic === 'reader'
              ? 'muted'
              : finding.severity === 'P0'
                ? 'danger'
                : finding.severity === 'P1'
                  ? 'warning'
                  : 'info'
          }
        >
          {finding.critic === 'reader' ? '建议 · 不阻断' : finding.severity}
        </Badge>
        <strong>{m.critics[finding.critic]}</strong>
        <span>v{finding.draftVersion}</span>
        <button className="ws-text-button" aria-label={m.close} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <p>{finding.reason}</p>
      <div className="finding-evidence">
        <span>{m.evidence}</span>
        {finding.evidenceRefs.map((ref) => (
          <code key={ref}>{ref}</code>
        ))}
      </div>
      <p className="finding-direction">
        <b>{m.suggestion}</b>
        {finding.suggestion}
      </p>
      <footer>
        <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={onIgnore}>
          {m.ignore}
        </Button>
        <Button
          size="sm"
          variant={finding.severity === 'P0' ? 'human' : 'default'}
          disabled={busy || disabled}
          disabledReason={disabled ? m.saveBlocked : undefined}
          onClick={onSuggest}
        >
          {finding.severity === 'P0' ? m.structural : m.requestSuggestion}
          <ArrowUpRight size={13} />
        </Button>
      </footer>
    </aside>
  );
}
