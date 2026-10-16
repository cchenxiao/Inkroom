import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Field, Input, Textarea } from '@/shared/ui';
import { styleAnalysisMessages as t } from '@/shared/lib/messages-style-analysis';
import { planningMessages as p } from '@/shared/lib/messages-planning';
import { styleAnalysisApi, styleAnalysisKey } from '../api/style-analysis';
import type { StyleAnalysisJob } from '../types/style-analysis';

export default function ReferenceStyleAnalysis({
  canUse,
  onUse,
}: {
  canUse: boolean;
  onUse: (job: StyleAnalysisJob) => void;
}) {
  const query = useQuery({
    queryKey: styleAnalysisKey,
    queryFn: ({ signal }) => styleAnalysisApi.list(signal),
    retry: false,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'running') ? 1200 : false),
  });
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [error, setError] = useState('');
  const request = useRef<{ title: string; text: string; id: string } | null>(null);
  const reload = () => client.invalidateQueries({ queryKey: styleAnalysisKey });
  const start = useMutation({
    mutationFn: () => {
      if (!request.current || request.current.title !== title || request.current.text !== text)
        request.current = { title, text, id: crypto.randomUUID() };
      return styleAnalysisApi.start({ title, text, requestId: request.current.id });
    },
    onSuccess: async (job) => {
      request.current = null;
      setSelectedID(job.id);
      setError('');
      await reload();
    },
    onError: (err: Error) => {
      setError(err.message);
      void reload();
    },
  });
  const count = Array.from(text).length;
  const valid = count <= 30000 && Array.from(text.trim()).length >= 80;
  const running = query.data?.some((j) => j.status === 'running');
  const job = query.data?.find((j) => j.id === selectedID) ?? query.data?.[0];
  return (
    <details className="reference-style-analysis" open>
      <summary>{t.title}</summary>
      <div className="planning-panel">
        <p className="text-dim">{t.note}</p>
        <Field label={t.source}>
          <Input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t.text} hint={t.limit}>
          <Textarea
            aria-label={t.text}
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.placeholder}
          />
        </Field>
        <div className="planning-actions">
          <Button
            variant="default"
            disabled={!valid || start.isPending || running || query.isError || query.isLoading}
            disabledReason={running ? t.running : t.invalid}
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            {t.analyze}
          </Button>
          <small className={count > 30000 ? 'page-error' : 'text-dim'}>
            {count.toLocaleString()} / 30,000 字符
          </small>
          <Button size="sm" onClick={() => void query.refetch()}>
            {t.retry}
          </Button>
        </div>
        {count > 30000 && (
          <p role="alert" className="page-error">
            {t.invalid}
          </p>
        )}
        {error && (
          <p role="alert" className="page-error">
            {error}
          </p>
        )}
        {query.isError && (
          <p role="alert" className="page-error">
            {t.error}
          </p>
        )}
        {query.isLoading && <p role="status">{p.loading}</p>}
        {running && (
          <p role="status" className="planning-running">
            {t.running}
          </p>
        )}
        {!query.isLoading && !query.isError && !job && <p className="text-dim">{t.empty}</p>}
        {job && (
          <section className="reference-style-result" aria-label={t.result}>
            <div className="planning-heading">
              <h3>{job.input.title || t.unnamed}</h3>
              <Badge>{p.status[job.status]}</Badge>
              <Badge tone="ai">{job.model}</Badge>
            </div>
            <p>
              {t.scope}：{job.input.analyzedCharacters.toLocaleString()} /{' '}
              {job.input.totalCharacters.toLocaleString()} 字符
            </p>
            <small className="text-dim">{t.scopeNote}</small>
            <details>
              <summary>{t.scope}</summary>
              {job.input.samples.map((sample) => (
                <div key={sample.start}>
                  <small>
                    第 {sample.start + 1}–{sample.end} 字符
                  </small>
                  <blockquote className="style-reference-quote">{sample.text}</blockquote>
                </div>
              ))}
            </details>
            <p className="text-dim">
              {t.fullStats} · {t.mean} {job.input.stats.mean.toFixed(1)} 字/句 · {t.variance}{' '}
              {job.input.stats.variance.toFixed(1)}
            </p>
            {job.message && <p role="status">{job.message}</p>}
            {job.output && (
              <>
                <Badge tone="warning">{t.draft}</Badge>
                <div className="style-observations">
                  {job.output.observations.map((o) => (
                    <article key={o.dimension}>
                      <div className="planning-heading">
                        <h4>{t.dimensions[o.dimension]}</h4>
                        <small>{o.certainty === 'observed' ? t.observed : t.tentative}</small>
                      </div>
                      <blockquote className="style-reference-quote">
                        <span className="sr-only">{t.evidence}</span>
                        {o.quote}
                      </blockquote>
                      <p>{o.reason}</p>
                      <p className="text-dim">{o.suggestion}</p>
                    </article>
                  ))}
                </div>
                <p className="text-dim">{job.output.limitations}</p>
                <Button
                  disabled={!canUse || query.isError || job.status !== 'completed'}
                  disabledReason={t.needDirection}
                  onClick={() => onUse(job)}
                >
                  {t.use}
                </Button>
                {!canUse && <p className="text-dim">{t.needDirection}</p>}
              </>
            )}
            <details className="planning-trace">
              <summary>{t.trace}</summary>
              <p>
                {job.promptVersion} · {job.schemaVersion}
              </p>
              {job.calls.map((c) => (
                <p key={c.number}>
                  #{c.number} · {c.phase} · {c.elapsedMs} ms ·{' '}
                  {c.usage.known
                    ? `${c.usage.inputTokens + c.usage.outputTokens} tokens`
                    : '用量未知'}
                </p>
              ))}
            </details>
            <details>
              <summary>{t.original}</summary>
              <pre className="reference-original">{job.input.text}</pre>
            </details>
          </section>
        )}
        <details className="planning-history">
          <summary>{t.history}</summary>
          {query.data?.map((j) => (
            <button key={j.id} onClick={() => setSelectedID(j.id)}>
              <span>
                {j.input.title || t.unnamed} · {new Date(j.createdAt).toLocaleString('zh-CN')}
              </span>
              <span>{p.status[j.status]}</span>
            </button>
          ))}
        </details>
        {job && text !== job.input.text && text && <small className="text-dim">{t.unsaved}</small>}
      </div>
    </details>
  );
}
