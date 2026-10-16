import { useState } from 'react';
import { Badge, Button, Card, Input } from '@/shared/ui';
import { ApiError } from '@/shared/api/client';
import { knowledgeMessages as t } from '@/shared/lib/messages-knowledge';
import { useKnowledge } from '../hooks/useKnowledge';
import KnowledgeSnapshot from './KnowledgeSnapshot';

export default function BackendKnowledge() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [entry, setEntry] = useState('');
  const parsed = Number(entry);
  const valid = /^[1-9]\d*$/.test(entry) && Number.isSafeInteger(parsed) && parsed <= 2147483647;
  const query = useKnowledge(version, open);
  const missing = query.isError && query.error instanceof ApiError && query.error.status === 404;
  return (
    <Card className="knowledge-panel">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <span>{t.title}</span> <Badge>{t.source}</Badge>
        </summary>
        {open && (
          <div className="knowledge-section">
            <p className="text-dim">{t.description}</p>
            <div className="knowledge-row">
              <Button
                onClick={() => void query.refetch()}
                loading={query.isFetching}
                disabledReason={t.refreshing}
              >
                {t.refresh}
              </Button>
              {version > 0 && <Button onClick={() => setVersion(0)}>{t.current}</Button>}
              <form
                className="knowledge-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid) {
                    if (parsed === version) void query.refetch();
                    else setVersion(parsed);
                  }
                }}
              >
                <label className="knowledge-version">
                  {t.versionInput}
                  <Input
                    aria-label={t.versionInput}
                    type="number"
                    min={1}
                    max={2147483647}
                    step={1}
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                  />
                </label>
                <Button
                  type="submit"
                  disabled={!valid || query.isFetching}
                  disabledReason={query.isFetching ? t.refreshing : t.invalidVersion}
                >
                  {t.history}
                </Button>
              </form>
            </div>
            <div aria-busy={query.isFetching}>
              {query.isPending && <p role="status">{t.loading}</p>}
              {missing && (
                <div role="status">
                  <h3>{version ? t.historyMissing : t.empty}</h3>
                  <p className="text-dim">{version ? t.historyNote : t.emptyNote}</p>
                </div>
              )}
              {query.isError && !missing && <p role="alert">{t.error}</p>}
              {query.isSuccess && <KnowledgeSnapshot value={query.data} historical={version > 0} />}
            </div>
          </div>
        )}
      </details>
    </Card>
  );
}
