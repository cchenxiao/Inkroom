import { useShallow } from 'zustand/react/shallow';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  PanelLeft,
  PanelRight,
  Play,
  Check,
  Command,
  Plus,
  LockKeyhole,
} from 'lucide-react';
import { useAction, useBranches, useChapter, useProject, useTree } from '@/shared/api/hooks';
import { Badge, Button, Modal, Input, Tooltip } from '@/shared/ui';
import { useUIStore } from '@/shared/lib/ui-store';
import { finalizeBlockers } from '@/shared/lib/rules';
import { shellText as t } from '@/shared/lib/messages-shell';
import { zh } from '@/shared/lib/messages';
import type { Branch, QualityScore, RunState } from '@/types/domain';
export function TopBar() {
  const ui = useUIStore(
    useShallow(({ events: _events, node: _node, streamText: _stream, ...state }) => state),
  );
  const { data: p } = useProject();
  const { data } = useChapter();
  const { data: branches } = useBranches();
  const { data: tree } = useTree();
  const [score, setScore] = useState<QualityScore | null>(null);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const start = useAction<RunState>('/runs');
  const approve = useAction(`/runs/${data?.run.id}/actions`);
  const branch = useAction<Branch>('/branches');
  const blockers = data
    ? [
        ...finalizeBlockers(data.scores, ui.stale),
        ...(data.run.draftVersion !== data.chapter.draftVersion ? [t.reviewOutdated] : []),
        ...(data.run.status === 'running' ? [zh.common.streaming] : []),
      ]
    : [zh.common.loading];
  const index = tree?.findIndex((c) => c.id === ui.chapterId) ?? -1;
  return (
    <>
      <header className="top-bar">
        <div className="book-identity">
          <span className="book-name">{p?.name ?? zh.brand}</span>
          <ChevronDown size={13} />
          <span className="top-divider" />
          <GitBranch size={13} />
          <select
            aria-label={t.branch}
            value={ui.branchId}
            onChange={(e) => ui.setBranch(e.target.value)}
          >
            {branches
              ?.filter((b) => b.status === 'active')
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.newBranch}
            onClick={() => setCreate(true)}
          >
            <Plus size={13} />
          </Button>
        </div>
        <div className="chapter-breadcrumb">
          <span>{data ? `第 ${data.chapter.number} 章 · ${data.chapter.title}` : t.draft}</span>
          <Badge>v{data?.chapter.draftVersion ?? '—'}</Badge>
          <Badge tone="warning">{data && zh.status[data.chapter.status]}</Badge>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.previous}
            disabled={index <= 0}
            disabledReason={t.previous}
            onClick={() => tree && ui.setChapter(tree[index - 1].id)}
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.next}
            disabled={!tree || index >= tree.length - 1}
            disabledReason={t.next}
            onClick={() => tree && ui.setChapter(tree[index + 1].id)}
          >
            <ChevronRight size={14} />
          </Button>
        </div>
        <div className="top-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.command}
            onClick={() => ui.setCommand(true)}
          >
            <Command size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.toggleLeft}
            onClick={() => ui.setPanel('left', !ui.leftOpen)}
          >
            <PanelLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.toggleRight}
            onClick={() => ui.setPanel('right', !ui.rightOpen)}
          >
            <PanelRight size={16} />
          </Button>
          <Button
            variant="default"
            size="sm"
            loading={start.isPending}
            disabled={data?.run.status === 'running' || !data}
            disabledReason={zh.common.streaming}
            onClick={() =>
              start.mutate(
                {
                  chapterId: ui.chapterId,
                  branchId: ui.branchId,
                  draftVersion: data?.chapter.draftVersion,
                  maxRounds: ui.maxRounds,
                },
                {
                  onSuccess: (r) => {
                    ui.setRun(r.id);
                    ui.setDrawer('half');
                  },
                },
              )
            }
          >
            <Play size={13} />
            {t.continue}
          </Button>
          <Button
            size="sm"
            disabled={blockers.length > 0 || data?.chapter.status === 'finalized'}
            disabledReason={blockers.join('；') || zh.status.finalized}
            loading={approve.isPending}
            onClick={() =>
              approve.mutate({ action: 'approve', draftVersion: data?.chapter.draftVersion })
            }
          >
            <Check size={14} />
            {t.finalize}
          </Button>
        </div>
      </header>
      <div className="context-bar">
        <span className="context-path">
          {zh.brandEn}
          <span>/</span>
          {zh.nav.workspace}
          <span>/</span>
          {p?.genre}
        </span>
        <div className="gate-chips">
          {data?.scores.items.map((s) => (
            <Tooltip key={s.key} content={s.calibrated ? zh.common.calibrated : zh.common.hint}>
              <button
                className={`gate-chip ${s.calibrated && !s.passed ? 'failing' : ''}`}
                onClick={() => setScore(s)}
              >
                <span
                  className={`gate-dot ${!s.calibrated ? 'hint' : s.passed ? 'pass' : 'fail'}`}
                />
                {s.label}
                <span className="gate-value">{s.value}</span>
                {!s.calibrated && <span className="hint-tag">{zh.common.hint}</span>}
              </button>
            </Tooltip>
          ))}
        </div>
        <button className="context-review" onClick={() => navigate('/review')}>
          {zh.nav.review}
          <ChevronRight size={12} />
        </button>
      </div>
      <Modal
        open={!!score}
        onOpenChange={() => setScore(null)}
        title={t.gateTitle}
        description={t.gateDescription}
      >
        {score && (
          <div className="stack">
            <div className="row">
              <Badge tone={score.passed ? 'success' : 'warning'}>
                {score.label} {score.value}
              </Badge>
              <Badge>{score.calibrated ? zh.common.calibrated : zh.common.hint}</Badge>
            </div>
            {score.features.map((f) => (
              <div className="evidence-box" key={f.label}>
                <strong>
                  {f.label} · {f.value}
                </strong>
                <p>{f.reason}</p>
                <small>
                  {f.source} · {f.calibrated ? zh.common.calibrated : zh.common.hint}
                </small>
              </div>
            ))}
          </div>
        )}
      </Modal>
      <Modal
        open={create}
        onOpenChange={setCreate}
        title={t.newBranch}
        footer={
          <Button
            variant="human"
            disabled={!name.trim()}
            disabledReason={t.newBranchName}
            loading={branch.isPending}
            onClick={() =>
              branch.mutate(
                { name, fromBranchId: ui.branchId },
                {
                  onSuccess: (b) => {
                    ui.setBranch(b.id);
                    setCreate(false);
                  },
                },
              )
            }
          >
            <GitBranch size={14} />
            {t.create}
          </Button>
        }
      >
        <Input
          placeholder={t.newBranchName}
          aria-label={t.newBranchName}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="muted">
          <LockKeyhole size={12} /> {zh.nav.versions}
        </p>
      </Modal>
    </>
  );
}
