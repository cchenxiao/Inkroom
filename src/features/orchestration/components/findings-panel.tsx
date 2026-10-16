import { useEffect } from 'react';
import { AlertTriangle, ArrowUpRight, LocateFixed } from 'lucide-react';
import { Badge, Button, Empty } from '@/shared/ui';
import { useAction } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { zh } from '@/shared/lib/messages';
import { shellText as t } from '@/shared/lib/messages-shell';
import type { ChapterDocument, Finding } from '@/types/domain';
function FindingRow({ finding, version }: { finding: Finding; version: number }) {
  const ui = useUIStore();
  const ignore = useAction(`/findings/${finding.id}/ignore`);
  return (
    <div className="run-finding">
      <Badge
        tone={
          finding.critic === 'reader'
            ? 'muted'
            : finding.severity === 'P0'
              ? 'danger'
              : finding.severity === 'P1'
                ? 'warning'
                : 'info'
        }
      >
        {finding.critic === 'reader' ? '建议' : finding.severity}
      </Badge>
      <div>
        <strong>
          {zh.critics[finding.critic]} · {zh.repair[finding.repairScope]}
        </strong>
        <p>{finding.reason}</p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t.locate}
        onClick={() => {
          ui.selectSegment(finding.segmentId);
          ui.selectFinding(finding.id);
          ui.setDrawer('closed');
        }}
      >
        <LocateFixed size={15} />
      </Button>
      <Button
        size="sm"
        onClick={() => {
          ui.selectSegment(finding.segmentId);
          ui.selectFinding(finding.id);
          ui.setDrawer('closed');
        }}
      >
        {zh.common.preview}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        loading={ignore.isPending}
        onClick={() => ignore.mutate({ draftVersion: version, reason: '作者保留当前表达' })}
      >
        {zh.common.reject}
      </Button>
    </div>
  );
}
export function FindingsPanel({ data }: { data: ChapterDocument }) {
  const ui = useUIStore();
  const findings = data.findings.filter((f) => f.status === 'open');
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        !(e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') ||
        (e.target instanceof HTMLElement &&
          e.target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))
      )
        return;
      e.preventDefault();
      const s = useUIStore.getState();
      const index = findings.findIndex((f) => f.id === s.selectedFinding);
      const next =
        findings[
          (index + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1) + findings.length) %
            findings.length
        ];
      if (next) {
        s.selectFinding(next.id);
        s.selectSegment(next.segmentId);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [findings]);
  return (
    <div className="findings-columns">
      <section>
        <div className="section-title">
          {t.findings}
          <Badge>{findings.length}</Badge>
        </div>
        {findings.length ? (
          findings.map((f) => (
            <FindingRow key={f.id} finding={f} version={data.chapter.draftVersion} />
          ))
        ) : (
          <Empty title={t.noFindings} />
        )}
      </section>
      <section className="conflict-queue">
        <div className="section-title">
          <AlertTriangle size={14} />
          {t.conflict}
        </div>
        {data.conflicts
          .filter((c) => c.status === 'open')
          .map((c) => (
            <div className="conflict-preview" key={c.id}>
              <strong>{c.title}</strong>
              <p>{c.bibleSays}</p>
              <p>{c.manuscriptSays}</p>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  ui.setDrawer('closed');
                  ui.setAttention('conflicts');
                }}
              >
                {t.resolve}
                <ArrowUpRight size={13} />
              </Button>
            </div>
          ))}
        {!data.conflicts.some((c) => c.status === 'open') && <Empty title={t.noConflicts} />}
      </section>
    </div>
  );
}
