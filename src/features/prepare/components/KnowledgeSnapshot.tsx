import { TechnicalDetails } from '@/shared/ui/technical-details';
import { useState } from 'react';
import { Badge, Tabs } from '@/shared/ui';
import { knowledgeMessages as t } from '@/shared/lib/messages-knowledge';
import type { StoredKnowledge } from '../types/knowledge';
import { KnowledgeFacts, KnowledgeForeshadows, KnowledgeTimeline } from './KnowledgeSections';

export default function KnowledgeSnapshot({
  value,
  historical,
}: {
  value: StoredKnowledge;
  historical: boolean;
}) {
  const [tab, setTab] = useState('facts');
  const snapshot = value.snapshot;
  return (
    <div className="knowledge-section">
      <div className="knowledge-row">
        <h3>
          {historical ? t.historyVersion(snapshot.version) : t.currentVersion(snapshot.version)}
        </h3>
        <Badge tone={value.origin === 'human' ? 'human' : 'warning'}>
          {value.origin === 'human' ? t.human : t.teaching}
        </Badge>
      </div>
      <dl className="knowledge-meta">
        <div>
          <dt>
            {t.project} / {t.branch}
          </dt>
          <dd>本作品 / {snapshot.branchId === 'main' ? '主线' : '试写分支'}</dd>
        </div>
        <div>
          <dt>{t.published}</dt>
          <dd>
            <time dateTime={value.createdAt}>
              {new Date(value.createdAt).toLocaleString('zh-CN')}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t.reason}</dt>
          <dd>{value.reason}</dd>
        </div>
      </dl>
      <TechnicalDetails
        items={{
          作品编号: snapshot.projectId,
          分支编号: snapshot.branchId,
          快照校验值: value.digest,
        }}
      />
      <p className="text-dim">{t.authorNote}</p>
      {historical && <p className="text-dim">{t.historyNote}</p>}
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'facts', label: t.facts, content: <KnowledgeFacts snapshot={snapshot} /> },
          {
            value: 'timeline',
            label: t.timeline,
            content: <KnowledgeTimeline snapshot={snapshot} />,
          },
          {
            value: 'foreshadows',
            label: t.foreshadows,
            content: <KnowledgeForeshadows snapshot={snapshot} />,
          },
        ]}
      />
    </div>
  );
}
