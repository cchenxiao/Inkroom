import { useMemo } from 'react';
import { ReactFlow, Background, MarkerType, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { zh } from '@/shared/lib/messages';
import type { RunNode, RunState } from '@/types/domain';
const positions: Record<RunNode, [number, number]> = {
  assemble: [0, 100],
  draft: [175, 100],
  hard_consistency: [355, 0],
  style: [355, 70],
  ai_taste: [355, 140],
  reader: [355, 210],
  aggregate: [535, 100],
  structural_reviser: [535, -80],
  scene_reviser: [715, 0],
  micro_polisher: [715, 160],
  human_gate: [900, 100],
  bible_update: [1080, 100],
  commit: [1260, 100],
};
export function RunFlowGraph({
  run,
  current,
  onSelect,
}: {
  run: RunState;
  current: RunNode | null;
  onSelect: (n: RunNode) => void;
}) {
  const active = current ?? run.currentNode;
  const nodes: Node[] = useMemo(
    () =>
      Object.entries(positions).map(([id, [x, y]]) => ({
        id,
        position: { x, y },
        data: { label: zh.nodes[id as RunNode] },
        className: `run-graph-node ${id === active || run.nodes.find((n) => n.id === id)?.status === 'running' ? 'is-current' : ''} ${run.nodes.find((n) => n.id === id)?.status === 'done' ? 'is-done' : ''}`,
        style: { width: 140 },
        sourcePosition: 'right' as Node['sourcePosition'],
        targetPosition: 'left' as Node['targetPosition'],
      })),
    [run.nodes, active],
  );
  const edges: Edge[] = useMemo(() => {
    const paths: [RunNode, RunNode, string?][] = [
      ['assemble', 'draft'],
      ...(['hard_consistency', 'style', 'ai_taste', 'reader'] as RunNode[]).flatMap(
        (n) =>
          [
            ['draft', n],
            [n, 'aggregate'],
          ] as [RunNode, RunNode][],
      ),
      ['aggregate', 'human_gate'],
      ['aggregate', 'structural_reviser', 'P0'],
      ['structural_reviser', 'draft', 'Beat / 大纲'],
      ['aggregate', 'scene_reviser', 'P1'],
      ['scene_reviser', 'aggregate'],
      ['aggregate', 'micro_polisher', 'P2'],
      ['micro_polisher', 'style', '复检'],
      ['micro_polisher', 'hard_consistency', '复检'],
      ['human_gate', 'bible_update'],
      ['bible_update', 'commit'],
    ];
    return paths.map(([source, target, label]) => ({
      id: `${source}-${target}`,
      source,
      target,
      label,
      animated:
        source === active ||
        target === active ||
        run.nodes.some((n) => n.id === source && n.status === 'running'),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-dim)' },
      style: {
        stroke: source === active ? 'var(--ai)' : 'var(--text-dim)',
        opacity: source === active ? 1 : 0.45,
        strokeWidth: 1.5,
      },
      labelStyle: { fill: 'var(--text-dim)', fontSize: 10 },
      labelBgStyle: { fill: 'var(--panel)' },
    }));
  }, [active, run.nodes]);
  return (
    <div className="run-flow" aria-label="Agent 编排状态图">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.3}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, n) => onSelect(n.id as RunNode)}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={20} />
      </ReactFlow>
    </div>
  );
}
