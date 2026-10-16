import { plannedNodes } from '@/shared/lib/node-capabilities';
import { studio } from '@/shared/lib/messages-studio';
import { Badge, Empty } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
import { zh } from '@/shared/lib/messages';
import type { RunNode, RunState } from '@/types/domain';
export function NodeInspector({
  run,
  selected,
  currentVersion,
}: {
  run: RunState;
  selected: RunNode | null;
  currentVersion: number;
}) {
  const node = run.nodes.find((n) => n.id === (selected ?? run.currentNode));
  if (plannedNodes.has(selected ?? run.currentNode))
    return (
      <section className="node-inspector">
        <div className="section-title">
          {zh.nodes[selected ?? run.currentNode]} <Badge>{studio.planned}</Badge>
        </div>
        <p>{studio.planningNote}</p>
      </section>
    );
  if (!node)
    return (
      <section className="node-inspector">
        <Empty title={t.idle} />
      </section>
    );
  return (
    <section className="node-inspector">
      <div className="section-title">
        {t.trace}
        <Badge tone="ai">{zh.nodes[node.id]}</Badge>
      </div>
      <p className="node-version-context">
        {studio.reviewVersion} draft v{node.inputVersion} · {studio.currentVersion} v
        {currentVersion}
      </p>
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
