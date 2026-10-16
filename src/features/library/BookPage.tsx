import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, GitBranch, PencilLine } from 'lucide-react';
import { useBook } from './api';
import OverviewChapters from './components/OverviewChapters';
import OverviewContext from './components/OverviewContext';
import OverviewQuality from './components/OverviewQuality';
import { useAction } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { enterBook, workPath } from '@/shared/lib/book-context';
import { libraryMessages as t } from '@/shared/lib/messages-library';
import {
  AsyncState,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Progress,
} from '@/shared/ui';
import type { Branch } from '@/types/domain';
import './library.css';

export default function BookPage() {
  const { projectId = '' } = useParams();
  const overview = useBook(projectId);
  const navigate = useNavigate();
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const createBranch = useAction<Branch, { projectId: string; fromBranchId: string; name: string }>(
    '/branches',
  );
  const book = overview.data;
  function openWork(
    page: string,
    chapterId = book?.project.currentChapterId ?? '',
    section?: string,
    segmentId?: string,
  ) {
    if (!book) return;
    enterBook(projectId, chapterId, book.branchId);
    if (segmentId) useUIStore.getState().selectSegment(segmentId);
    const destination = workPath(page, projectId, chapterId, section);
    navigate(segmentId ? `${destination}&segmentId=${encodeURIComponent(segmentId)}` : destination);
  }
  function openPrepare(section: string) {
    if (!book) return;
    const key = section === 'premise' ? 'direction' : section;
    if (book.wizardId && !book.confirmed[key as keyof typeof book.confirmed]) {
      navigate(
        `/library/new?projectId=${encodeURIComponent(projectId)}&step=${['premise', 'style', 'world', 'outline'].indexOf(section)}`,
      );
    } else openWork('prepare', undefined, section);
  }
  return (
    <main className="page-content book-overview-page">
      <div className="overview-breadcrumb">
        <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
          <ArrowLeft size={14} />
          {t.title}
        </Button>
        <span>/</span>
        <span>{t.overview}</span>
      </div>
      <AsyncState
        loading={overview.isLoading}
        error={overview.error}
        onRetry={() => void overview.refetch()}
      >
        {book && (
          <>
            <PageHeader
              title={book.project.name}
              actions={
                <>
                  <Button
                    disabled={!book.confirmed.outline || !book.chapters.length}
                    disabledReason="确认章节大纲后可创建试写分支"
                    onClick={() => {
                      setBranchName('');
                      createBranch.reset();
                      setBranchOpen(true);
                    }}
                  >
                    <GitBranch size={14} />
                    {t.newBranch}
                  </Button>
                  <Button
                    variant="default"
                    onClick={() =>
                      !book.confirmed.outline
                        ? navigate(`/library/new?projectId=${encodeURIComponent(projectId)}`)
                        : openWork('workspace')
                    }
                  >
                    <PencilLine size={14} />
                    {!book.confirmed.outline
                      ? t.resumePlan
                      : `继续写第 ${book.chapters.find((c) => c.id === book.project.currentChapterId)?.number ?? 1} 章`}
                  </Button>
                </>
              }
            />
            <div className="overview-book-meta">
              <Badge tone="ai">{book.project.genre || '类型待定'}</Badge>
              <Badge tone={book.status === 'finalized' ? 'success' : 'muted'}>
                {t.stage[book.status]}
              </Badge>
              <span>
                <GitBranch size={13} />
                {book.branchName}
              </span>
              <span>
                {book.project.tone} · {book.project.pov} · {book.project.tense}
              </span>
              <Button variant="ghost" size="sm" onClick={() => openPrepare('premise')}>
                创作方向
                <ArrowRight size={12} />
              </Button>
            </div>
            {book.confirmed.direction ? (
              <p className="overview-logline">{book.project.logline}</p>
            ) : (
              <p className="overview-logline muted">创作方向待确认，完成向导后展示故事梗概。</p>
            )}
            <p className="library-demo">
              <Badge tone="warning">{t.demo}</Badge>
              <span>{t.demoNote}</span>
            </p>
            <div className="overview-stat-grid">
              <Card>
                <span>{t.words}</span>
                <strong>
                  {book.totalWords.toLocaleString('zh-CN')}
                  <small> / {book.project.targetWords.toLocaleString('zh-CN')} 字</small>
                </strong>
                <Progress
                  value={
                    book.project.targetWords
                      ? Math.min(
                          100,
                          Math.round((book.totalWords / book.project.targetWords) * 100),
                        )
                      : 0
                  }
                  label="全书字数进度"
                />
              </Card>
              <Card>
                <span>{t.finalized}</span>
                <strong>
                  {book.finalizedChapters}
                  <small> / {book.totalChapters} 章</small>
                </strong>
                <Progress
                  value={
                    book.totalChapters
                      ? Math.round((book.finalizedChapters / book.totalChapters) * 100)
                      : 0
                  }
                  label="全书定稿进度"
                />
              </Card>
              <Card>
                <span>{t.beats}</span>
                <strong>
                  {book.beatProgress.done}
                  <small> / {book.beatProgress.total}</small>
                </strong>
                <Progress
                  value={
                    book.beatProgress.total
                      ? Math.round((book.beatProgress.done / book.beatProgress.total) * 100)
                      : 0
                  }
                  label="全书 Beat 进度"
                />
              </Card>
            </div>
            {book.worstFinding && (
              <div className="overview-critical" role="note">
                <Badge tone="danger">{book.worstFinding.severity}</Badge>
                <span>
                  <strong>当前最严重问题</strong> · {book.worstFinding.reason}
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    openWork(
                      'workspace',
                      book.worstFinding!.chapterId,
                      undefined,
                      book.worstFinding!.segmentId,
                    )
                  }
                >
                  定位原文
                </Button>
              </div>
            )}
            <div className="overview-layout">
              <div className="overview-main">
                <OverviewChapters
                  book={book}
                  onChapter={(id) => openWork('workspace', id)}
                  onPrepare={openPrepare}
                />
              </div>
              <aside aria-label="全书设定">
                <OverviewQuality
                  book={book}
                  onReports={() => openWork('reports')}
                  onChapter={(id, segmentId) => openWork('workspace', id, undefined, segmentId)}
                />
                <OverviewContext
                  book={book}
                  onPrepare={openPrepare}
                  onChapter={(id, segmentId) => openWork('workspace', id, undefined, segmentId)}
                />
              </aside>
            </div>
          </>
        )}
      </AsyncState>
      <Modal
        open={branchOpen}
        onOpenChange={setBranchOpen}
        title={t.newBranch}
        description={t.branchHint}
        footer={
          <>
            <Button onClick={() => setBranchOpen(false)} disabled={createBranch.isPending}>
              取消
            </Button>
            <Button
              variant="default"
              loading={createBranch.isPending}
              disabled={!branchName.trim() || !book}
              onClick={() => {
                if (!book) return;
                enterBook(projectId, book.project.currentChapterId, book.branchId);
                void createBranch
                  .mutateAsync({ projectId, fromBranchId: book.branchId, name: branchName.trim() })
                  .then((branch) => {
                    enterBook(projectId, book.project.currentChapterId, branch.id);
                    setBranchOpen(false);
                    navigate(workPath('workspace', projectId, book.project.currentChapterId));
                  })
                  .catch(() => undefined);
              }}
            >
              {t.createBranch}
            </Button>
          </>
        }
      >
        <Field label={t.branchName}>
          <Input
            value={branchName}
            maxLength={80}
            autoFocus
            placeholder="例如：另一种开场"
            onChange={(event) => setBranchName(event.target.value)}
          />
        </Field>
        {createBranch.error && (
          <p role="alert" className="page-error">
            {createBranch.error.message}
          </p>
        )}
      </Modal>
    </main>
  );
}
