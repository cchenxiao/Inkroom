import { BookOpen, GitBranch, MoreHorizontal, Plus, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLibrary } from './api';
import { AsyncState, Badge, Button, Card, Empty, PageHeader, Progress } from '@/shared/ui';
import { bookPath, enterBook, workPath } from '@/shared/lib/book-context';
import { libraryMessages as t } from '@/shared/lib/messages-library';
import type { BookSummary } from '@/types/domain/library';
import './library.css';

export default function LibraryPage() {
  const books = useLibrary();
  const navigate = useNavigate();
  function openBook(book: BookSummary, write = false) {
    enterBook(book.project.id, book.project.currentChapterId, book.branchId);
    navigate(
      write
        ? workPath('workspace', book.project.id, book.project.currentChapterId)
        : bookPath(book.project.id),
    );
  }
  return (
    <main className="page-content library-page">
      <PageHeader
        title={t.title}
        actions={
          <Button variant="default" onClick={() => navigate('/library/new')}>
            <Plus size={15} />
            {t.newBook}
          </Button>
        }
      />
      <p className="library-demo">
        <Badge tone="warning">{t.demo}</Badge>
        <span>{t.demoNote}</span>
      </p>
      <AsyncState
        loading={books.isLoading}
        error={books.error}
        onRetry={() => void books.refetch()}
      >
        {books.data?.length ? (
          <div className="library-grid">
            {books.data.map((book) => {
              const progress =
                book.project.targetWords > 0
                  ? Math.min(100, Math.round((book.totalWords / book.project.targetWords) * 100))
                  : 0;
              return (
                <Card
                  key={book.project.id}
                  className={`library-book library-accent-${book.accent}`}
                >
                  <div className="library-book-cover">
                    <BookOpen size={23} aria-hidden="true" />
                    <span>{book.project.genre || '类型待定'}</span>
                    <details className="library-book-menu">
                      <summary aria-label={`${book.project.name}操作菜单`}>
                        <MoreHorizontal size={18} />
                      </summary>
                      <div className="library-menu-items">
                        <Button variant="ghost" size="sm" onClick={() => openBook(book)}>
                          {t.overview}
                        </Button>
                        {book.wizardId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate(
                                `/library/new?projectId=${encodeURIComponent(book.project.id)}`,
                              )
                            }
                          >
                            {t.resumePlan}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            enterBook(
                              book.project.id,
                              book.project.currentChapterId,
                              book.branchId,
                            );
                            navigate(
                              workPath('versions', book.project.id, book.project.currentChapterId),
                            );
                          }}
                        >
                          版本与分支
                        </Button>
                      </div>
                    </details>
                  </div>
                  <div className="library-book-body">
                    <div className="library-book-title">
                      <h2>{book.project.name}</h2>
                      <Badge
                        tone={
                          book.status === 'finalized'
                            ? 'success'
                            : book.status === 'planning'
                              ? 'muted'
                              : 'ai'
                        }
                      >
                        {t.stage[book.status]}
                      </Badge>
                    </div>
                    <p className="library-logline">
                      {book.project.logline || '故事正在酝酿，继续向导完善创作方向。'}
                    </p>
                    <div className="library-book-progress">
                      <span>
                        {book.totalWords.toLocaleString('zh-CN')} /{' '}
                        {book.project.targetWords.toLocaleString('zh-CN')} 字
                      </span>
                      <strong>{progress}%</strong>
                    </div>
                    <Progress value={progress} label={`${book.project.name}字数进度`} />
                    <div className="library-book-meta">
                      <span>
                        <GitBranch size={13} />
                        {book.branchName}
                      </span>
                      <span>
                        {book.finalizedChapters} / {book.totalChapters} 章定稿
                      </span>
                    </div>
                    <small className="library-updated">
                      最近修改 · {formatDate(book.updatedAt)}
                    </small>
                    <div className="library-book-actions">
                      <Button
                        variant="default"
                        onClick={() =>
                          !book.totalChapters
                            ? navigate(
                                `/library/new?projectId=${encodeURIComponent(book.project.id)}`,
                              )
                            : openBook(book, true)
                        }
                      >
                        {!book.totalChapters ? t.resumePlan : t.continue}
                        <ArrowRight size={14} />
                      </Button>
                      <Button onClick={() => openBook(book)}>{t.overview}</Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="library-empty">
            <Empty title={t.emptyTitle} description={t.emptyHint} />
            <Button variant="default" onClick={() => navigate('/library/new')}>
              <Plus size={15} />
              {t.newBook}
            </Button>
          </Card>
        )}
      </AsyncState>
    </main>
  );
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '尚未记录'
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}
