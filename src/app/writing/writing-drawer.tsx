import { lazy, Suspense, useState } from 'react';
import { Activity, ChevronUp, ChevronDown, Maximize2, Minimize2, X } from 'lucide-react';
import { sentenceDiff } from '@/shared/lib/diff';
import { Button } from '@/shared/ui';
import { useUIStore } from '@/shared/lib/ui-store';
import { writingDesk as t } from '@/shared/lib/messages-writing-desk';
import { ContextManifest, type BackendRun } from '@/features/prepare/writing';
const RunFlow = lazy(() =>
  import('@/features/prepare/writing').then((m) => ({ default: m.RunFlow })),
);
export function WritingDrawer({
  run,
  onFinding,
  title,
}: {
  run?: BackendRun;
  title?: string;
  onFinding: (id: string) => void;
}) {
  const size = useUIStore((s) => s.drawer),
    setDrawer = useUIStore((s) => s.setDrawer);
  const [tab, setTab] = useState('flow');
  const open = size !== 'closed';
  return (
    <section
      className={`run-drawer writing-run-drawer ${size === 'full' ? 'is-full' : ''}`}
      style={{ height: open ? (size === 'full' ? 'calc(100% - 52px)' : 'min(42vh, 420px)') : 44 }}
      aria-label="Agent 工作台"
    >
      <header className="run-drawer-header">
        <button
          className="drawer-toggle"
          onClick={() => setDrawer(open ? 'closed' : 'half')}
          aria-expanded={open}
        >
          <Activity size={16} />
          <strong>Agent 工作台</strong>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <span className={`run-status ${run?.status === 'running' ? 'is-running' : ''}`}>
          <i />
          {run ? t.statuses[run.status] : t.noRun}
        </span>
        <span className="drawer-spacer" />
        <span className="mono">{run?.tokens?.toLocaleString() ?? 0} tokens</span>
        <span>
          自动返工 {run?.reviseRound ?? 0}/{run?.maxRounds ?? 2}
        </span>
        {open && (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label={size === 'full' ? '退出全屏' : '全屏编排'}
              onClick={() => setDrawer(size === 'full' ? 'half' : 'full')}
            >
              {size === 'full' ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="收起 Agent 工作台"
              onClick={() => setDrawer('closed')}
            >
              <X size={15} />
            </Button>
          </>
        )}
      </header>
      {open && (
        <>
          <nav className="writing-panel-tabs" aria-label="运行详情">
            {[
              ['flow', t.flow],
              ['findings', t.findings],
              ['context', t.inspector],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="writing-run-content">
            {!run ? (
              <p>{t.noRun}</p>
            ) : tab === 'flow' ? (
              <Suspense fallback={<p>载入编排图…</p>}>
                <RunFlow run={run} title={title} />
              </Suspense>
            ) : tab === 'context' ? (
              <ContextManifest run={run} />
            ) : (
              <>
                <div className="writing-findings">
                  {run.result?.report.findings.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        onFinding(f.id);
                        setDrawer('closed');
                      }}
                    >
                      <span className={`severity-${f.severity.toLowerCase()}`}>{f.severity}</span>
                      <span>{f.reason}</span>
                      <span>定位正文 →</span>
                    </button>
                  ))}
                </div>
                {!run.result?.report.findings.length && <p>{t.noFindings}</p>}
                <div className="writing-revisions">
                  {run.result?.revisions.map((revision, index) => (
                    <details key={index} open>
                      <summary>
                        第 {revision.round} 轮 · v{revision.fromVersion} → v{revision.toVersion}
                      </summary>
                      {revision.patches.map((patch, i) => (
                        <div className="sentence-change" key={i}>
                          <div className="sentence-text">
                            {sentenceDiff(patch.oldText, patch.newText).map((part, j) =>
                              part.kind === 'insert' ? (
                                <ins key={j}>{part.text}</ins>
                              ) : part.kind === 'delete' ? (
                                <del key={j}>{part.text}</del>
                              ) : (
                                <span key={j}>{part.text}</span>
                              ),
                            )}
                          </div>
                          <p>{patch.reason}</p>
                        </div>
                      ))}
                    </details>
                  ))}
                  {!run.result?.revisions.length && <p className="muted">本次没有自动修订记录。</p>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
