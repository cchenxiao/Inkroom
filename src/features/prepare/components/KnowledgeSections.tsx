import { Badge } from '@/shared/ui';
import { knowledgeMessages as t } from '@/shared/lib/messages-knowledge';
import type { KnowledgeLocation, StoredKnowledge } from '../types/knowledge';

type Snapshot = StoredKnowledge['snapshot'];
function Location({ value }: { value: KnowledgeLocation }) {
  return (
    <span className="text-dim" title={value.chapterId}>
      {t.location(value.at.chapter, value.segmentId, value.at.storyTime)}
    </span>
  );
}
export function KnowledgeFacts({ snapshot }: { snapshot: Snapshot }) {
  const facts = snapshot.facts ?? [];
  return (
    <div className="knowledge-section">
      <p className="text-dim">{t.infoNote}</p>
      {!facts.length && <p>{t.noFacts}</p>}
      {facts.map((fact) => {
        const states = (snapshot.information ?? []).filter((i) => i.factId === fact.id);
        return (
          <article key={fact.id} className="knowledge-entry">
            <h3>{fact.text}</h3>
            <p>
              <Location value={fact.source} /> · v{fact.version}
            </p>
            {!states.length ? (
              <p className="text-dim">{t.noKnowledge}</p>
            ) : (
              <div className="knowledge-table-scroll">
                <table className="data-table">
                  <caption className="sr-only">{fact.text}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t.subject}</th>
                      <th scope="col">{t.state}</th>
                      <th scope="col">{t.acquisition}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {states.map((info) => (
                      <tr key={info.subjectId}>
                        <th scope="row">
                          {info.subjectId === 'reader' ? t.reader : info.subjectId}
                        </th>
                        <td>
                          <Badge tone={info.state === 'known' ? 'human' : 'warning'}>
                            {info.state === 'known' ? t.known : t.belief}
                          </Badge>
                          {info.belief && <p>{info.belief}</p>}
                        </td>
                        <td>
                          <Location value={info.source} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
export function KnowledgeTimeline({ snapshot }: { snapshot: Snapshot }) {
  const events = [...(snapshot.timeline ?? [])].sort(
    (a, b) => a.source.at.storyTime - b.source.at.storyTime,
  );
  const names = new Map(events.map((e) => [e.id, e.summary]));
  const facts = new Map((snapshot.facts ?? []).map((f) => [f.id, f.text]));
  return (
    <div className="knowledge-section">
      <p className="text-dim">{t.timelineNote}</p>
      {!events.length && <p>{t.noTimeline}</p>}
      {events.map((event) => (
        <article key={event.id} className="knowledge-entry">
          <h3>{event.summary}</h3>
          <p>
            <Location value={event.source} />
          </p>
          {!!event.factIds?.length && (
            <p>
              {t.eventFacts}：{event.factIds.map((id) => facts.get(id) ?? id).join('；')}
            </p>
          )}
          {!!event.causalBefore?.length && (
            <p>
              {t.before}：{event.causalBefore.map((id) => names.get(id) ?? id).join('；')}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
export function KnowledgeForeshadows({ snapshot }: { snapshot: Snapshot }) {
  const clues = snapshot.foreshadows ?? [];
  return (
    <div className="knowledge-section">
      <p className="text-dim">{t.authorPlan}</p>
      <p className="text-dim">{t.foreshadowNote}</p>
      {!clues.length && <p>{t.noForeshadows}</p>}
      {clues.map((clue) => (
        <article key={clue.id} className="knowledge-entry">
          <div className="knowledge-row">
            <h3>{clue.title}</h3>
            <Badge tone="foreshadow">{clue.importance}</Badge>
            <Badge>{t.statuses[clue.status]}</Badge>
          </div>
          <p>{clue.payload}</p>
          <p>
            {t.planted}：<Location value={clue.planted} />
          </p>
          <p>{t.plan(clue.planResolveChapter)}</p>
          {clue.resolved && (
            <p>
              {t.resolved}：<Location value={clue.resolved} />
            </p>
          )}
          {clue.abandonReason && (
            <p>
              {t.abandonReason}：{clue.abandonReason}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
