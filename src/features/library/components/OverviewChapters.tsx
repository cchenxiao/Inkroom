import { ArrowRight, CheckCheck, Layers3 } from 'lucide-react';
import { Badge, Button, Card, Empty, Progress } from '@/shared/ui';
import { zh } from '@/shared/lib/messages';
import { libraryMessages as t } from '@/shared/lib/messages-library';
import type { BookOverview } from '@/types/domain/library';

export default function OverviewChapters({
  book,
  onChapter,
  onPrepare,
}: {
  book: BookOverview;
  onChapter: (id: string) => void;
  onPrepare: (section: string) => void;
}) {
  const assigned = new Set(book.acts.flatMap((act) => act.chapterIds));
  const unassigned = book.chapters.filter((chapter) => !assigned.has(chapter.id));
  const groups = [
    ...book.acts,
    ...(unassigned.length
      ? [
          {
            id: 'unassigned',
            title: '待分幕章节',
            chapterIds: unassigned.map((chapter) => chapter.id),
          },
        ]
      : []),
  ];
  return (
    <Card className="overview-chapters">
      <div className="overview-panel-heading">
        <h2>
          <Layers3 size={16} />
          {t.chapters}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => onPrepare('outline')}>
          查看大纲
          <ArrowRight size={13} />
        </Button>
      </div>
      {!book.confirmed.outline ? (
        <div className="overview-pending">
          <Badge>{t.pending}</Badge>
          <p>章节大纲尚未确认。{t.pendingHint}</p>
          <Button size="sm" onClick={() => onPrepare('outline')}>
            确认大纲
          </Button>
        </div>
      ) : book.chapters.length ? (
        groups.map((act) => {
          const chapters = act.chapterIds
            .map((id) => book.chapters.find((chapter) => chapter.id === id))
            .filter((chapter) => chapter !== undefined);
          return (
            <section key={act.id} className="overview-act">
              <div className="overview-act-title">
                <h3>{act.title}</h3>
                <small>
                  {chapters.length} 章 ·{' '}
                  {chapters
                    .reduce((total, chapter) => total + chapter.wordCount, 0)
                    .toLocaleString('zh-CN')}{' '}
                  字
                </small>
              </div>
              <div className="overview-chapter-grid">
                {chapters.map((chapter) => {
                  const beats = chapter.scenes.flatMap((scene) => scene.beats);
                  const completed = beats.filter((beat) => beat.status === 'done').length;
                  return (
                    <button
                      className={`overview-chapter ${chapter.id === book.project.currentChapterId ? 'is-current' : ''}`}
                      key={chapter.id}
                      onClick={() => onChapter(chapter.id)}
                    >
                      <div className="overview-chapter-top">
                        <span className="overview-chapter-number">
                          {String(chapter.number).padStart(2, '0')}
                        </span>
                        <Badge
                          tone={
                            chapter.status === 'finalized'
                              ? 'success'
                              : chapter.status === 'planned'
                                ? 'muted'
                                : 'ai'
                          }
                        >
                          {chapter.status === 'finalized' && <CheckCheck size={11} />}
                          {zh.status[chapter.status]}
                        </Badge>
                      </div>
                      <h4>{chapter.title}</h4>
                      <p>
                        {chapter.wordCount.toLocaleString('zh-CN')} /{' '}
                        {chapter.targetWords.toLocaleString('zh-CN')} 字
                      </p>
                      <Progress
                        value={beats.length ? Math.round((completed / beats.length) * 100) : 0}
                        label={`第${chapter.number}章 Beat 进度`}
                      />
                      <div className="overview-chapter-bottom">
                        <span>
                          Beat {completed} / {beats.length}
                        </span>
                        {chapter.issueCount > 0 ? (
                          <span className="overview-chapter-issues">
                            {chapter.issueCount} 项待处理
                          </span>
                        ) : (
                          <ArrowRight size={13} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })
      ) : (
        <Empty title="暂无章节" description="在创作准备中确认大纲后，章节会出现在这里。" />
      )}
    </Card>
  );
}
