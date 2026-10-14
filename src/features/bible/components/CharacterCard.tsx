import { LockKeyhole, Pencil } from 'lucide-react';
import { Button, Badge, Card, Chart } from '@/shared/ui';
import { pages as t } from '@/shared/lib/messages-pages';
import type { Character } from '@/types/domain';
export default function CharacterCard({
  character: c,
  related,
  onEdit,
  onLock,
}: {
  character: Character;
  related: boolean;
  onEdit: () => void;
  onLock: () => void;
}) {
  return (
    <Card className={`character-card ${related ? 'related' : ''}`}>
      <div className="page-row">
        <div className="character-identity">
          <div className="character-avatar">{c.name.slice(-1)}</div>
          <div>
            <h3>{c.name}</h3>
            <small>{c.role}</small>
          </div>
        </div>
        {c.locked && <LockKeyhole size={13} />}
      </div>
      <p className="quiet">{c.description}</p>
      <dl className="character-motivations">
        <div>
          <dt>{t.bible.want}</dt>
          <dd>{c.want}</dd>
        </div>
        <div>
          <dt>{t.bible.need}</dt>
          <dd>{c.need}</dd>
        </div>
        <div>
          <dt>{t.bible.flaw}</dt>
          <dd>{c.flaw}</dd>
        </div>
      </dl>
      <div className="page-row">
        <small>{t.bible.arc}</small>
        <small>{c.arcProgress}%</small>
      </div>
      <div className="arc-track">
        <span style={{ width: `${c.arcProgress}%` }} />
      </div>
      <p className="quiet">{c.arcStage}</p>
      <details>
        <summary>
          {t.bible.traits} · {t.bible.voice}
        </summary>
        <dl className="detail-list">
          {Object.entries(c.hardTraits).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="voice-tags">
          {c.voice.tags.map((tag) => (
            <Badge key={tag} tone="ai">
              {tag}
            </Badge>
          ))}
        </div>
        <p>
          {c.voice.register} · {c.voice.sentenceStyle}
        </p>
        {c.voice.catchphrases.map((phrase) => (
          <blockquote key={phrase}>{phrase}</blockquote>
        ))}
        <VoiceRadar character={c} />
        <h4>{t.bible.facts}</h4>
        <dl className="detail-list">
          {Object.entries(c.knows).map(([fact, ch]) => (
            <div key={fact}>
              <dt>{fact}</dt>
              <dd>
                {t.common.chapter} {ch}
              </dd>
            </div>
          ))}
        </dl>
        <h4>{t.bible.status}</h4>
        {Object.entries(c.statusAtChapter).map(([ch, status]) => (
          <p key={ch}>
            {ch} · {status}
          </p>
        ))}
      </details>
      <div className="bible-card-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={c.locked}
          disabledReason={t.common.readOnly}
          onClick={onEdit}
        >
          <Pencil size={12} />
          {t.common.edit}
        </Button>
        <Button variant="ghost" size="sm" onClick={onLock}>
          {c.locked ? t.common.unlock : t.common.lock}
        </Button>
      </div>
    </Card>
  );
}
function VoiceRadar({ character }: { character: Character }) {
  return (
    <Chart
      height={180}
      option={{
        radar: { indicator: t.bible.radar.map((name) => ({ name, max: 100 })), radius: '62%' },
        series: [
          {
            type: 'radar',
            data: [{ value: character.voice.radar, name: character.name }],
            areaStyle: { opacity: 0.15 },
          },
        ],
      }}
    />
  );
}
