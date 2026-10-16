import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './backend-run-flow.css';
import { TechnicalDetails } from '@/shared/ui/technical-details';
import { backendMessages as t } from '@/shared/lib/messages-backend';
import type { BackendRun } from '../types/backend';

const positions: Record<string, [number, number]> = {
  context_assemble: [0, 80],
  draft: [210, 80],
  hard_consistency: [420, 25],
  ai_taste: [420, 135],
  aggregate: [630, 80],
  micro_edit: [840, -30],
  scene_reviser: [840, 80],
  structural_reviser: [840, 190],
  human_gate: [1050, 80],
  human_edit: [1050, 190],
  commit: [1260, 80],
};
const forward: [string, string][] = [
  ['context_assemble', 'draft'],
  ['draft', 'hard_consistency'],
  ['draft', 'ai_taste'],
  ['hard_consistency', 'aggregate'],
  ['ai_taste', 'aggregate'],
  ['aggregate', 'micro_edit'],
  ['aggregate', 'scene_reviser'],
  ['aggregate', 'structural_reviser'],
  ['aggregate', 'human_gate'],
  ['human_gate', 'human_edit'],
  ['human_gate', 'commit'],
];
const repairs = ['micro_edit', 'scene_reviser', 'structural_reviser', 'human_edit'];
export default function BackendRunFlow({
  run,
  title = '本段创作',
}: {
  run: BackendRun;
  title?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const { nodes, edges } = useMemo(() => {
    const roles = (run.activeRoles ?? []).map((role) =>
      role === 'writer'
        ? 'draft'
        : role === 'polisher'
          ? 'micro_edit'
          : role === 'context_assembler'
            ? 'context_assemble'
            : role,
    );
    const active = (id: string) =>
      run.status === 'running' &&
      (roles.includes(id) ||
        (run.currentNode === id && roles.length === 0 && run.result?.nodePhase !== 'finished'));
    const completed = new Set<string>();
    if (run.commitId || run.status === 'committed') completed.add('commit');
    if (run.inputDigest) completed.add('context_assemble');
    if (run.status === 'approved' || run.status === 'committed') completed.add('human_gate');
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
        ? '正在处理'
        : completed.has(id)
          ? '已完成'
          : run.currentNode === id && ['failed', 'interrupted'].includes(run.status)
            ? '未完成'
            : run.currentNode === id && id === 'human_gate'
              ? '等待你判断'
              : '未执行';
    const nodes: Node[] = Object.entries(positions).map(([id, [x, y]]) => ({
      id,
      position: { x, y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: `${id === 'commit' && run.planning ? '采用本段' : t.graphNodes[id]} · ${label(id)}`,
        state: label(id),
      },
      className: active(id)
        ? 'backend-flow-active'
        : run.currentNode === id
          ? 'backend-flow-current'
          : '',
      style: { width: 180 },
      ariaLabel: `${id === 'commit' && run.planning ? '采用本段' : t.graphNodes[id]} · ${label(id)}`,
    }));
    const edges: Edge[] = forward.map(([source, target]) => ({
      id: `${source}-${target}`,
      source,
      target,
      ariaLabel: `${t.graphNodes[source]} → ${t.graphNodes[target]}`,
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
          ariaLabel: `${t.graphNodes[source]} → ${t.graphNodes[target]}（修改后复检）`,
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
  const stages = [
    { title: '准备材料', ids: ['context_assemble'], note: '查找设定与前文' },
    { title: '生成正文', ids: ['draft'], note: '形成待审核候选' },
    {
      title: '检查正文',
      ids: ['hard_consistency', 'ai_taste', 'aggregate'],
      note: '核对一致性与语言',
    },
    {
      title: '按需修订',
      ids: ['micro_edit', 'scene_reviser', 'structural_reviser', 'human_edit'],
      note: '有问题时修改并复检',
    },
    { title: '作者判断', ids: ['human_gate'], note: '由你批准或提出修改' },
    {
      title: run.planning ? '采用本段' : '保存定稿',
      ids: ['commit'],
      note: run.planning ? '纳入章稿，仍需整章审核' : '保留可追溯版本',
    },
  ];
  const stateOf = (ids: string[]) => {
    const values = nodes.filter((n) => ids.includes(n.id)).map((n) => n.data.state);
    if (values.includes('正在处理')) return '正在处理';
    if (values.includes('未完成')) return '未完成';
    if (values.includes('等待你判断')) return '等待你判断';
    if (ids.includes('micro_edit')) return values.includes('已完成') ? '已修订' : '本次未执行';
    return values.every((v) => v === '已完成')
      ? '已完成'
      : values.includes('已完成')
        ? '部分完成'
        : '未执行';
  };
  const current =
    (run.currentNode === 'commit' && run.planning ? '采用本段' : t.nodes[run.currentNode]) ||
    '等待流程状态更新';
  return (
    <section className="backend-flow-panel" aria-label="本次创作进度">
      <header className="backend-flow-heading">
        <div>
          <h3>
            {title} · 候选 v{run.draftVersion}
          </h3>
          <p>
            {run.status === 'committed'
              ? '本段已采用，可继续写作或进入整章审核。'
              : run.status === 'running'
                ? `正在${current}`
                : run.status === 'approved'
                  ? '作者已批准，请核对事实后采用。'
                  : run.status === 'waiting_human' || run.status === 'needs_human'
                    ? '正文已停在审核处，等待你的判断。'
                    : `进度停在：${current}`}
          </p>
        </div>
        <span>
          自动修订 {run.reviseRound} / {run.maxRounds} 轮
        </span>
      </header>
      <ol className="backend-flow-stages">
        {stages.map((stage, index) => (
          <li key={stage.title}>
            <span className="backend-stage-order">{index + 1}</span>
            <div>
              <strong>{stage.title}</strong>
              <span className="backend-stage-state" data-state={stateOf(stage.ids)}>
                {stateOf(stage.ids)}
              </span>
              <p>{stage.note}</p>
            </div>
          </li>
        ))}
      </ol>
      <details
        className="backend-flow-diagram"
        onToggle={(event) => setDiagramOpen(event.currentTarget.open)}
      >
        <summary>查看完整流程与执行细节</summary>
        <p className="muted">滚轮上下滚动面板；拖动画布查看步骤，使用左下角按钮缩放。</p>
        {diagramOpen && (
          <div className="backend-flow" aria-label={t.liveGraph}>
            <ReactFlow
              ariaLabelConfig={{
                'controls.ariaLabel': '流程图视图',
                'controls.zoomIn.ariaLabel': '放大流程图',
                'controls.zoomOut.ariaLabel': '缩小流程图',
                'controls.fitView.ariaLabel': '适应流程图',
              }}
              nodes={nodes}
              edges={edges}
              fitView
              fitViewOptions={{ padding: 0.05, minZoom: 0.75, maxZoom: 1 }}
              minZoom={0.3}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              panOnScroll={false}
              preventScrolling={false}
              maxZoom={1.6}
              nodesDraggable={false}
              nodesConnectable={false}
              onNodeClick={(_, node) => setSelected(node.id)}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--border)" gap={24} />
              <Controls
                showInteractive={false}
                fitViewOptions={{ padding: 0.05, minZoom: 0.75, maxZoom: 1 }}
              />
            </ReactFlow>
          </div>
        )}
        {selected && (
          <div className="backend-node-inspector">
            <strong>
              {selected === 'commit' && run.planning ? '采用本段' : t.graphNodes[selected]}
            </strong>
            <p>
              {nodes.find((n) => n.id === selected)?.data.state as string} · 候选 v
              {run.draftVersion}
            </p>
          </div>
        )}
      </details>
      <TechnicalDetails
        items={{ 运行编号: run.id, 最新事件序号: run.eventSequence, 内部步骤: run.currentNode }}
      />
    </section>
  );
}
