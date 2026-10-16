import { Link } from 'react-router-dom';
import { Badge, Button, Card, PageHeader, StatNumber, EmptyState } from '@/shared/ui';
import { liveWorkspacePath } from '@/shared/lib/writing-mode';
import { liveBookText as t } from '@/shared/lib/messages-live-book';
import { useLiveBook } from './api/live-book';
import { livePreparePath, nextBookPath } from './live-book-path';
import './library.css';
export default function LiveBookPage() {
  const q = useLiveBook(),
    b = q.data;
  if (q.isError)
    return (
      <main className="page-content">
        <PageHeader title={t.title} />
        <p role="alert">{t.error}</p>
        <Button onClick={() => void q.refetch()}>{t.refresh}</Button>
        <Link to="/library">返回书架</Link>
      </main>
    );
  if (!b)
    return (
      <main className="page-content">
        <p role="status">正在读取作品…</p>
      </main>
    );
  const groups = [...new Set(b.chapters.map((c) => c.act || '章节'))];
  return (
    <main className="page-content book-overview-page live-book-overview">
      <div className="overview-breadcrumb">
        <Link to="/library">作品书架</Link>
        <span>/</span>
        <span>{t.title}</span>
      </div>
      <PageHeader
        title={b.name}
        actions={
          <>
            <Button size="sm" loading={q.isFetching} onClick={() => void q.refetch()}>
              {t.refresh}
            </Button>
            <Link className="ui-button button-primary button-normal" to={nextBookPath(b)}>
              {b.nextSection ? t.prepare : b.nextStage === 'assembly' ? t.review : t.write}
            </Link>
          </>
        }
      />
      <div className="overview-book-meta">
        <Badge>{b.genre || t.unknown}</Badge>
        <span>目标 {b.targetWords || '待定'} 字</span>
        <span>
          {b.style?.pov || '视角待确认'} · {b.style?.tense || '时态待确认'}
        </span>
      </div>
      {b.premise && <p className="live-book-premise">{b.premise}</p>}
      <div className="live-book-progress">
        <span>
          {t.words}{' '}
          <strong>
            <StatNumber>{b.acceptedWords.toLocaleString()} 字</StatNumber>
          </strong>
        </span>
        <span>
          {t.finalized}{' '}
          <strong>
            <StatNumber>
              {b.finalizedChapters} / {b.chapters.length}
            </StatNumber>{' '}
            章
          </strong>
        </span>
        <span>
          {t.beats}{' '}
          <strong>
            <StatNumber>
              {b.doneBeats} / {b.totalBeats}
            </StatNumber>
          </strong>
        </span>
      </div>
      <details className="live-book-details">
        <summary>{t.recordDetails}</summary>
        <p>{t.boundary}</p>
        <p>{t.countNote}</p>
      </details>
      <div className="overview-layout">
        <div className="overview-main">
          <Card>
            <div className="overview-panel-heading">
              <h2>{t.chapters}</h2>
              <Link to={livePreparePath('outline')}>{t.outline}</Link>
            </div>
            {!b.chapters.length ? (
              <div className="overview-pending">
                <h3>{t.empty}</h3>
                <p>{t.emptyNote}</p>
                <Link className="ui-button button-primary button-normal" to={nextBookPath(b)}>
                  {t.prepare}
                </Link>
              </div>
            ) : (
              <>
                <p className="muted live-book-caption">{t.chapterBoundary}</p>
                {groups.map((act) => (
                  <section className="overview-act" key={act}>
                    <div className="overview-act-title">
                      <h3>{act}</h3>
                      <small>{b.chapters.filter((c) => (c.act || '章节') === act).length} 章</small>
                    </div>
                    <div className="overview-chapter-grid">
                      {b.chapters
                        .filter((c) => (c.act || '章节') === act)
                        .map((c) => (
                          <Link
                            className={`overview-chapter ${c.id === b.currentChapterId ? 'is-current' : ''}`}
                            key={c.id}
                            to={
                              c.id === b.currentChapterId
                                ? liveWorkspacePath(
                                    c.id,
                                    ['in_review', 'human', 'finalized'].includes(c.status)
                                      ? 'assembly'
                                      : 'write',
                                  )
                                : livePreparePath('outline', c.id)
                            }
                          >
                            <div className="overview-chapter-top">
                              <span>第 {c.number} 章</span>
                              <Badge tone={c.status === 'finalized' ? 'success' : 'muted'}>
                                {t.status[c.status]}
                              </Badge>
                            </div>
                            <h4>{c.title}</h4>
                            <p>
                              {c.acceptedWords} 字可采用 · 目标 {c.targetWords} 字
                            </p>
                            <small>
                              {c.totalBeats
                                ? `${c.doneBeats} / ${c.totalBeats} 个情节段已采用`
                                : '细纲待展开'}
                            </small>
                            <p className="muted">{c.reason}</p>
                            {c.historicalPublication && <Badge tone="warning">{t.history}</Badge>}
                          </Link>
                        ))}
                    </div>
                  </section>
                ))}
              </>
            )}
          </Card>
        </div>
        <aside aria-label="真实作品资料" className="overview-context">
          <Card>
            <h2>{t.quality}</h2>
            {b.chapters.some((c) => c.acceptedWords > 0 || c.status === 'finalized') ? (
              <ul className="live-book-review-list">
                {b.chapters
                  .filter((c) => c.acceptedWords > 0 || c.status === 'finalized')
                  .map((c) => (
                    <li key={c.id}>
                      <span>第 {c.number} 章</span>
                      <p>{c.reviewSummary}</p>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState
                compact
                title="暂无整章审查"
                description="完成章稿并发起复审后，在这里查看审查结果。"
              />
            )}
            <p className="muted live-book-caption">{t.qualityNote}</p>
          </Card>
          <Card>
            <div className="overview-panel-heading">
              <h2>{t.characters}</h2>
              <Link to={livePreparePath('world')}>查看设定</Link>
            </div>
            {!b.characters.length ? (
              <EmptyState
                compact
                title="人物尚未确认"
                description="先在创作准备中确认人物与世界设定。"
              />
            ) : (
              b.characters.map((c) => (
                <article className="overview-character" key={c.id}>
                  <strong>{c.name}</strong>
                  <small> · {c.role}</small>
                  <dl>
                    <div>
                      <dt>想要</dt>
                      <dd>{c.want}</dd>
                    </div>
                    <div>
                      <dt>需要</dt>
                      <dd>{c.need}</dd>
                    </div>
                  </dl>
                  <p className="muted">弧光计划 · {c.arcIntent}</p>
                </article>
              ))
            )}
          </Card>
          <Card>
            <div className="overview-panel-heading">
              <h2>{t.style}</h2>
              <Link to={livePreparePath('style')}>查看风格</Link>
            </div>
            {b.style ? (
              <>
                <p>{b.style.tone}</p>
                <p>
                  目标句长 {b.style.sentenceLength.min}–{b.style.sentenceLength.max} 字 · 对白{' '}
                  {Math.round(b.style.dialogueRatio.min * 100)}–
                  {Math.round(b.style.dialogueRatio.max * 100)}%
                </p>
                <p className="muted">
                  禁用表达 {b.style.bannedPhrases.length} 项 · 目标范围，不是评测分数
                </p>
              </>
            ) : (
              <p className="muted">{t.noStyle}</p>
            )}
          </Card>
          <Card>
            <h2>{t.plans}</h2>
            {b.plans.length ? b.plans.map((p) => <p key={p.id}>{p.intent}</p>) : <p>{t.noPlans}</p>}
            <p className="muted live-book-caption">{t.planNote}</p>
          </Card>
        </aside>
      </div>
    </main>
  );
}
