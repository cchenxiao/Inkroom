import { bookPath, workPath } from '@/shared/lib/book-context';
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Command,
  Plus,
  Pause,
  Play,
  Check,
  PanelRightOpen,
} from 'lucide-react';
import { useAction, useBranches, useChapter, useProject, useTree } from '@/shared/api/hooks';
import { Badge, Button, Modal, Input } from '@/shared/ui';
import { useUIStore } from '@/shared/lib/ui-store';
import { deriveRunAction } from '@/shared/lib/run-action';
import { shellText as t } from '@/shared/lib/messages-shell';
import { zh } from '@/shared/lib/messages';
import type { Branch, RunState } from '@/types/domain';
export function TopBar() {
  const projectId = useUIStore((s) => s.projectId);
  const navigate = useNavigate();
  const branchId = useUIStore((s) => s.branchId);
  const chapterId = useUIStore((s) => s.chapterId);
  const stale = useUIStore((s) => s.stale);
  const { pathname, search } = useLocation();
  const changeBranch = (id: string) => {
    useUIStore.getState().setBranch(id);
    const query = new URLSearchParams(search);
    query.set('branchId', id);
    query.set('projectId', projectId);
    navigate(`${pathname}?${query}`);
  };
  const chapterRoute = pathname === '/workspace' || pathname === '/review';
  const { data: project } = useProject();
  const { data } = useChapter();
  const { data: branches } = useBranches();
  const { data: tree } = useTree();
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const start = useAction<RunState>('/runs');
  const action = useAction(`/runs/${data?.run.id}/actions`);
  const branch = useAction<Branch>('/branches');
  const primary = deriveRunAction(data, stale);
  const index = tree?.findIndex((c) => c.id === chapterId) ?? -1;
  const execute = () => {
    if (primary.disabled || !data) return;
    const ui = useUIStore.getState();
    if (primary.kind === 'review') {
      ui.setAttention('review');
      return;
    }
    if (primary.kind === 'start') {
      start.mutate(
        { chapterId, branchId, draftVersion: data.chapter.draftVersion, maxRounds: ui.maxRounds },
        { onSuccess: (run) => ui.setRun(run.id) },
      );
    } else {
      action.mutate({
        action: primary.kind === 'finalize' ? 'approve' : primary.kind,
        draftVersion: data.chapter.draftVersion,
      });
    }
  };
  if (pathname.startsWith('/library'))
    return (
      <header className="top-bar">
        <Link to="/library" className="book-name">
          我的作品
        </Link>
        <span className="muted">本地创作空间</span>
      </header>
    );
  const moveChapter = (id: string) => {
    useUIStore.getState().setChapter(id);
    navigate(workPath(pathname.slice(1), projectId, id));
  };
  return (
    <>
      <header className="top-bar">
        <div className="book-identity">
          <Link to={bookPath(projectId)} className="book-name">
            {project?.name ?? zh.brand}
          </Link>
          <span className="top-divider" />
          <GitBranch size={13} />
          <select
            aria-label={t.branch}
            value={branchId}
            onChange={(e) => changeBranch(e.target.value)}
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
            disabled={projectId !== 'project-zhuoliu' && !project?.locked}
            disabledReason="确认章节大纲后可创建试写分支"
            onClick={() => setCreate(true)}
          >
            <Plus size={13} />
          </Button>
        </div>
        {chapterRoute && (
          <div className="chapter-breadcrumb">
            <span>{data ? `第 ${data.chapter.number} 章 · ${data.chapter.title}` : t.draft}</span>
            <Badge>v{data?.chapter.draftVersion ?? '—'}</Badge>
            <Badge>{data && zh.status[data.chapter.status]}</Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.previous}
              disabled={index <= 0}
              disabledReason={t.previous}
              onClick={() => tree && moveChapter(tree[index - 1].id)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.next}
              disabled={!tree || index >= tree.length - 1}
              disabledReason={t.next}
              onClick={() => tree && moveChapter(tree[index + 1].id)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
        <div className="top-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t.command}
            onClick={() => useUIStore.getState().setCommand(true)}
          >
            <Command size={14} />
            <kbd>K</kbd>
          </Button>
          {pathname === '/workspace' && (
            <Button
              variant={primary.variant}
              size="sm"
              disabled={primary.disabled || projectId !== 'project-zhuoliu'}
              disabledReason={
                projectId !== 'project-zhuoliu'
                  ? '演示作品仅支持手动试写，尚未接入 Agent 执行与评审。'
                  : primary.reason
              }
              loading={start.isPending || action.isPending}
              onClick={execute}
            >
              {primary.kind === 'pause' ? (
                <Pause size={13} />
              ) : primary.kind === 'review' ? (
                <PanelRightOpen size={13} />
              ) : primary.kind === 'finalize' ? (
                <Check size={13} />
              ) : (
                <Play size={13} />
              )}{' '}
              {primary.label}
            </Button>
          )}
        </div>
      </header>
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
                { name, fromBranchId: branchId },
                {
                  onSuccess: (b) => {
                    changeBranch(b.id);
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
      </Modal>
    </>
  );
}
