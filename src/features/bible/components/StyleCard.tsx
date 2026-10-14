import { Button, Badge, Card } from '@/shared/ui';
import { pages as t } from '@/shared/lib/messages-pages';
import type { StyleProfile } from '@/types/domain';
export default function StyleCard({
  style,
  onEdit,
  onLock,
}: {
  style: StyleProfile;
  onEdit: () => void;
  onLock: () => void;
}) {
  return (
    <Card>
      <div className="page-row">
        <h3>{t.bible.anchor}</h3>
        {style.locked && <Badge tone="human">{t.common.locked}</Badge>}
      </div>
      <blockquote className="style-anchor">{style.anchorText}</blockquote>
      <div className="voice-tags">
        {[style.pov, style.tense, style.tone].map((s) => (
          <Badge key={s} tone="muted">
            {s}
          </Badge>
        ))}
      </div>
      <div className="metric-pair">
        <div>
          <strong>{style.statisticalTargets.sentenceLength}</strong>
          <small>{t.bible.sentenceLength}</small>
        </div>
        <div>
          <strong>{Math.round(style.statisticalTargets.dialogueRatio * 100)}%</strong>
          <small>{t.bible.dialogueRatio}</small>
        </div>
      </div>
      <h4>{t.bible.banned}</h4>
      <div className="voice-tags">
        {style.bannedWords.map((word) => (
          <Badge key={word} tone="danger">
            {word}
          </Badge>
        ))}
      </div>
      <div className="bible-card-actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={style.locked}
          disabledReason={t.common.readOnly}
        >
          {t.common.edit}
        </Button>
        <Button variant="ghost" size="sm" onClick={onLock}>
          {style.locked ? t.common.unlock : t.common.lock}
        </Button>
      </div>
    </Card>
  );
}
