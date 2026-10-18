import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBookArchive } from '@/features/prepare/api/book-archive';
import { useLiveBook } from '@/features/library/api/live-book';
import { livePreparePath, liveWorkspacePath } from '@/shared/lib/writing-mode';
import { GO_API_BASE } from '@/shared/api/client';
import { PageHeader, Button, Card, Badge, Select } from '@/shared/ui';
import './reports.css';
export default function LiveReportsPage() {
  const archive = useBookArchive(),
    book = useLiveBook();
  const [chapterId, setChapterId] = useState('');
  const chapters =
    archive.data?.chapters.filter((c) => !chapterId || c.chapterId === chapterId) ?? [];
  const current = book.data?.chapters.find((c) => c.id === book.data?.currentChapterId);
  const chapterPath = (c: { id: string; totalBeats: number }) =>
    c.totalBeats ? liveWorkspacePath(c.id, 'assembly') : livePreparePath('outline', c.id);
  return (
    <main className="page-content page-stack live-reports-page">
      <PageHeader
        title="质量检查与定稿记录"
        description="按实际保存的章稿、审查和作者判断查看结果。"
        actions={
          <Button
            loading={archive.isFetching || book.isFetching}
            onClick={() => {
              void archive.refetch();
              void book.refetch();
            }}
          >
            更新记录
          </Button>
        }
      />
      {(archive.isPending || book.isPending) && <p role="status">正在读取真实作品记录…</p>}
      {(archive.error || book.error) && (
        <p role="alert">{archive.error?.message || book.error?.message}</p>
      )}
      {book.data && (
        <Card>
          <h2>当前创作进度</h2>
          <p>
            {book.data.finalizedChapters} / {book.data.chapters.length} 章当前定稿 ·{' '}
            {book.data.doneBeats} / {book.data.totalBeats} 个情节段已采用
          </p>
          {current && (
            <div className="live-report-next">
              <strong>
                下一步 · 第 {current.number} 章 · {current.title}
              </strong>
              <p>
                {current.totalBeats && current.doneBeats < current.totalBeats
                  ? `本章 ${current.doneBeats}/${current.totalBeats} 段已有采用稿，继续处理其余段落。`
                  : current.reason}
              </p>
              <Link className="ui-button button-primary button-normal" to={chapterPath(current)}>
                {current.totalBeats ? '继续本章审核与定稿' : '完善本章细纲'}
              </Link>
            </div>
          )}
          <details>
            <summary>全部章节进度 · {book.data.chapters.length} 章</summary>
            <div className="live-report-chapters">
              {book.data.chapters.map((c) => (
                <article key={c.id}>
                  <strong>
                    第 {c.number} 章 · {c.title}
                  </strong>
                  <p>{c.reason}</p>
                  <p className="muted">{c.reviewSummary}</p>
                  <Link to={chapterPath(c)}>{c.totalBeats ? '查看本章审核' : '完善本章细纲'}</Link>
                </article>
              ))}
            </div>
          </details>
        </Card>
      )}
      {archive.data && (
        <>
          <div className="page-actions">
            <label>
              查看定稿章节
              <Select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
                <option value="">全部已定稿章节</option>
                {archive.data.chapters.map((c) => (
                  <option key={c.chapterId} value={c.chapterId}>
                    第 {c.number} 章 · {c.title}
                  </option>
                ))}
              </Select>
            </label>
            {!!archive.data.chapters.length && (
              <a
                className="ui-button button-secondary button-normal"
                href={`${GO_API_BASE}/planning/archive?format=text`}
                download
              >
                导出全部定稿正文
              </a>
            )}
          </div>
          {!chapters.length && (
            <Card>
              <p>尚无定稿记录。完成整章定稿后，会显示正文统计、审查意见及作者判断。</p>
            </Card>
          )}
          {chapters.map((c) => (
            <Card key={c.publicationId}>
              <div className="page-actions">
                <h2>
                  第 {c.number} 章 · {c.title} · v{c.version}
                </h2>
                <Badge tone={c.current ? 'success' : 'warning'}>
                  {c.current ? '当前定稿' : '历史定稿'}
                </Badge>
              </div>
              {!c.current && <p>{c.reason}</p>}
              <p>
                审查意见 {c.findings.length} 条 · 作者明确保留 {c.keptFindings?.length ?? 0} 条 ·
                已确认事实 {c.facts.length} 条
              </p>
              {c.statistics && (
                <>
                  <dl className="live-report-metrics">
                    <div>
                      <dt>句子数</dt>
                      <dd>{c.statistics.sentenceLengths.length}</dd>
                    </div>
                    <div>
                      <dt>平均句长</dt>
                      <dd>{c.statistics.mean.toFixed(1)} 字</dd>
                    </div>
                    <div>
                      <dt>句长标准差</dt>
                      <dd>{Math.sqrt(c.statistics.variance).toFixed(1)} 字</dd>
                    </div>
                  </dl>
                  <p className="muted">
                    复用文本统计引擎，句长不计空白和标点。这些数值描述节奏，不作为质量评分或定稿门槛。
                  </p>
                </>
              )}
              <details>
                <summary>审查意见与作者处理 · {c.findings.length} 条</summary>
                {c.findings.length ? (
                  c.findings.map((f) => (
                    <article key={`${f.critic}/${f.id}`}>
                      <Badge>{f.severity}</Badge>{' '}
                      <strong>
                        {f.critic === 'hard_consistency' ? '一致性与衔接' : '语言与重复'}
                      </strong>
                      <blockquote>{f.quote}</blockquote>
                      <p>{f.reason}</p>
                      <p>
                        {(c.keptFindings ?? []).includes(`${f.critic}/${f.id}`)
                          ? '作者已核对并保留原文'
                          : '已保存的审查记录'}
                      </p>
                    </article>
                  ))
                ) : (
                  <p>本次未报告问题，不能据此推断全文没有问题。</p>
                )}
              </details>
            </Card>
          ))}
        </>
      )}
    </main>
  );
}
