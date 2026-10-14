import { Badge, Empty } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
import { zh } from '@/shared/lib/messages';
import type { RunNode, RunState } from '@/types/domain';
export function NodeInspector({ run, selected }: { run: RunState; selected: RunNode | null }) {
  const node = run.nodes.find((n) => n.id === (selected ?? run.currentNode));
  if (!node) return <Empty title={t.idle} />;
  return (
    <section className="node-inspector">
      <div className="section-title">
        {t.trace}
        <Badge tone="ai">{zh.nodes[node.id]}</Badge>
      </div>
      <dl>
        <dt>{t.input}</dt>
        <dd>{node.input}</dd>
        <dt>{t.output}</dt>
        <dd>{node.output || t.idle}</dd>
        {node.reason && (
          <>
            <dt>{t.reason}</dt>
            <dd>{node.reason}</dd>
          </>
        )}
      </dl>
      <div className="trace-metrics">
        <span>
          {t.version}
          <b>v{node.inputVersion}</b>
        </span>
        <span>
          {t.tokens}
          <b>{node.tokens.toLocaleString()}</b>
        </span>
        <span>
          {t.duration}
          <b>{(node.durationMs / 1000).toFixed(1)}s</b>
        </span>
      </div>
      <small className="mono muted">{run.id}</small>
    </section>
  );
}
