import { useState } from 'react';
import {
  Activity,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Pause,
  Play,
  FastForward,
  X,
  GitBranch,
  AlertTriangle,
} from 'lucide-react';
import { useAction, useChapter, useResource } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { Badge, Button, Tabs, Select } from '@/shared/ui';
import { shellText as t } from '@/shared/lib/messages-shell';
import { zh } from '@/shared/lib/messages';
import type { RunNode, RunState } from '@/types/domain';
import { RunFlowGraph } from './components/run-flow-graph';
import { NodeInspector } from './components/node-inspector';
import { ContextManifestPanel } from './components/context-manifest-panel';
import { FindingsPanel } from './components/findings-panel';
export default function RunDrawer() {
  const { data } = useChapter();
  const ui = useUIStore();
  const runQuery = useResource<RunState>(`/runs/${data?.run.id}`, Boolean(data?.run.id));
  const [selected, setSelected] = useState<RunNode | null>(null);
  const [context, setContext] = useState(false);
  const action = useAction(`/runs/${data?.run.id}/actions`);
  if (!data) return null;
  const run = runQuery.data ?? data.run;
  const open = ui.drawer !== 'closed';
  const event = ui.events.at(-1);
  const act = (value: string) =>
    action.mutate({ action: value, draftVersion: data.chapter.draftVersion });
  return (
    <section className={`run-drawer drawer-${ui.drawer}`}>
      <header className="run-drawer-header">
        <button className="drawer-toggle" onClick={() => ui.setDrawer(open ? 'closed' : 'half')}>
          <Activity size={16} className={run.status === 'running' ? 'pulse' : ''} />
          <strong>{t.workbench}</strong>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <span className={`run-status ${run.status === 'running' ? 'is-running' : ''}`}>
          <i />
          {t.status[run.status]}
        </span>
        <span className="drawer-current">{event?.data.message ?? zh.nodes[run.currentNode]}</span>
        <span className="drawer-spacer" />
        <span className="rework-counter">
          {t.rounds}{' '}
          <b>
            {run.reviseRound}/{run.maxRounds}
          </b>
        </span>
        <button
          className="drawer-conflicts"
          onClick={() => {
            ui.setDrawer('half');
            ui.setDrawerTab('findings');
          }}
        >
          <AlertTriangle size={13} />
          {data.conflicts.filter((c) => c.status === 'open').length} {t.conflict}
        </button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={open ? t.collapse : t.expand}
          onClick={() => ui.setDrawer(open ? 'closed' : 'half')}
        >
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </Button>
      </header>
      {open && (
        <>
          <div className="run-controls">
            <Tabs
              value={ui.drawerTab}
              onValueChange={ui.setDrawerTab}
              items={[
                { value: 'flow', label: t.flow },
                { value: 'findings', label: t.findings },
              ]}
            />
            <Badge tone={run.reviseRound >= run.maxRounds ? 'warning' : 'muted'}>
              {t.escalate}
            </Badge>
            <label className="rounds-setting">
              {t.roundLimit}
              <Select
                aria-label={t.roundLimit}
                value={ui.maxRounds}
                onChange={(e) => ui.setMaxRounds(Number(e.target.value) as 2 | 3)}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
              </Select>
            </label>
            <div className="drawer-spacer" />
            <Button size="sm" onClick={() => setContext(!context)}>
              <GitBranch size={13} />
              {t.context}
            </Button>
            <Button
              size="sm"
              disabled={!['running', 'paused'].includes(run.status)}
              disabledReason={t.status[run.status]}
              onClick={() => act(run.status === 'paused' ? 'resume' : 'pause')}
            >
              {run.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}{' '}
              {run.status === 'paused' ? t.resume : t.pause}
            </Button>
            <Button
              size="sm"
              disabled={run.status !== 'running'}
              disabledReason={t.status[run.status]}
              onClick={() => act('fast_forward')}
            >
              <FastForward size={12} />
              {t.fast}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.full}
              onClick={() => ui.setDrawer(ui.drawer === 'full' ? 'half' : 'full')}
            >
              <Maximize2 size={14} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.cancelRun}
              disabled={['completed', 'canceled'].includes(run.status)}
              onClick={() => act('cancel')}
            >
              <X size={14} />
            </Button>
          </div>
          <div className="run-content">
            {ui.drawerTab === 'flow' ? (
              <>
                <RunFlowGraph run={run} current={ui.node} onSelect={setSelected} />
                {context ? (
                  <ContextManifestPanel runId={run.id} />
                ) : (
                  <NodeInspector run={run} selected={selected} />
                )}
              </>
            ) : (
              <FindingsPanel data={data} />
            )}
          </div>
          <footer className="run-trace-footer">
            <span className="mono">
              {run.id} · draft v{run.draftVersion}
            </span>
            <span>
              {run.tokens.toLocaleString()} tokens · {(run.elapsedMs / 1000).toFixed(1)}s
            </span>
            <span>{ui.events.length} events</span>
          </footer>
        </>
      )}
    </section>
  );
}
