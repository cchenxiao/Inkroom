import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import type { BackendRun } from '../types/backend';

const positions: Record<string, [number, number]> = {
  draft: [240, 0],
  hard_consistency: [100, 90],
  ai_taste: [380, 90],
  aggregate: [240, 180],
  micro_edit: [0, 290],
  scene_reviser: [240, 290],
  structural_reviser: [480, 290],
  human_gate: [240, 415],
  human_edit: [480, 415],
};
const forward: [string, string][] = [
  ['draft', 'hard_consistency'],
  ['draft', 'ai_taste'],
  ['hard_consistency', 'aggregate'],
  ['ai_taste', 'aggregate'],
  ['aggregate', 'micro_edit'],
  ['aggregate', 'scene_reviser'],
  ['aggregate', 'structural_reviser'],
  ['aggregate', 'human_gate'],
  ['human_gate', 'human_edit'],
];
const repairs = ['micro_edit', 'scene_reviser', 'structural_reviser', 'human_edit'];
export default function BackendRunFlow({ run }: { run: BackendRun }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => {
    const roles = (run.activeRoles ?? []).map((role) =>
      role === 'writer' ? 'draft' : role === 'polisher' ? 'micro_edit' : role,
    );
    const active = (id: string) =>
      run.status === 'running' &&
      (roles.includes(id) ||
        (run.currentNode === id && roles.length === 0 && run.result?.nodePhase !== 'finished'));
    const completed = new Set<string>();
    if (run.result?.segments.length) completed.add('draft');
    for (const critic of run.result?.criticReviews ?? []) {
      if (critic.status === 'completed' && critic.draftVersion === run.draftVersion)
        completed.add(critic.critic);
    }
    if (
      run.result?.report.draftVersion === run.draftVersion &&
      completed.has('hard_consistency') &&
      completed.has('ai_taste')
    )
      completed.add('aggregate');
    for (const revision of run.result?.revisions ?? []) {
      const node = {
        micro: 'micro_edit',
        scene: 'scene_reviser',
        structural: 'structural_reviser',
      }[revision.kind];
      if (node) completed.add(node);
    }
    const label = (id: string) =>
      active(id)
        ? t.graphRunning
        : run.currentNode === id
          ? t.currentStep
          : completed.has(id)
            ? t.graphFinished
            : t.graphWaiting;
    const nodes: Node[] = Object.entries(positions).map(([id, [x, y]]) => ({
      id,
      position: { x, y },
      data: { label: `${t.graphNodes[id]} · ${label(id)}` },
      className: active(id)
        ? 'backend-flow-active'
        : run.currentNode === id
          ? 'backend-flow-current'
          : '',
      style: { width: 160 },
      ariaLabel: `${t.graphNodes[id]} · ${label(id)}`,
    }));
    const edges: Edge[] = forward.map(([source, target]) => ({
      id: `${source}-${target}`,
      source,
      target,
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: repairs.includes(target) && active(target),
    }));
    const lastKind = run.result?.revisions?.at(-1)?.kind;
    const lastRepair = run.pendingAction
      ? 'human_edit'
      : lastKind === 'micro'
        ? 'micro_edit'
        : lastKind === 'scene'
          ? 'scene_reviser'
          : lastKind === 'structural'
            ? 'structural_reviser'
            : '';
    for (const source of repairs.filter((id) => id === lastRepair || active(id)))
      for (const target of ['hard_consistency', 'ai_taste']) {
        edges.push({
          id: `${source}-${target}`,
          source,
          target,
          type: 'smoothstep',
          animated:
            run.status === 'running' &&
            lastRepair === source &&
            (run.currentNode === 'critics' || roles.includes(target)),
          style: { stroke: 'var(--ai)', opacity: lastRepair === source ? 1 : 0.25 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--ai)' },
        });
      }
    return { nodes, edges };
  }, [run]);
  return (
    <section className="backend-flow-panel">
      <h3>{t.liveGraph}</h3>
      <p className="text-dim">{t.graphNote}</p>
      <div className="backend-flow" aria-label={t.liveGraph}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, node) => setSelected(node.id)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--border)" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selected && (
        <div className="backend-node-inspector">
          <strong>{t.graphNodes[selected]}</strong>
          <p>
            {t.currentStep}：{t.nodes[run.currentNode] ?? run.currentNode} · {t.version} v
            {run.draftVersion} · {t.progress} {run.reviseRound}/{run.maxRounds}
          </p>
          <p className="mono">
            run_id: {run.id} · event: {run.eventSequence}
          </p>
          <p>{t.graphEvidence}</p>
        </div>
      )}
    </section>
  );
}
