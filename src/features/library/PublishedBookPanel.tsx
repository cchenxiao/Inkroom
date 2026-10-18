import { Link } from 'react-router-dom';
import { Button, Card, Badge } from '@/shared/ui';
import { GO_API_BASE } from '@/shared/api/client';
import { useBookArchive } from '@/features/prepare/api/book-archive';
import { liveWorkspacePath } from '@/shared/lib/writing-mode';

export function PublishedBookPanel() {
  const q = useBookArchive();
  return (
    <Card>
      <div className="overview-panel-heading">
        <h2>定稿档案与导出</h2>
        <Button size="sm" loading={q.isFetching} onClick={() => void q.refetch()}>
          更新
        </Button>
      </div>
      {q.isPending && <p role="status">正在读取定稿记录…</p>}
      {q.isError && <p role="alert">{q.error.message}</p>}
      {q.data && (
        <>
          {!q.data.chapters.length ? (
            <p>尚无整章定稿。完成复审和事实确认后，这里会保留完整章稿及作者判断。</p>
          ) : (
            <>
              <p>
                已保存 {q.data.chapters.length}{' '}
                章定稿。导出按目录顺序收录各章最近一次定稿，不包含未采用候选。
              </p>
              <a
                className="ui-button button-primary button-normal"
                href={`${GO_API_BASE}/planning/archive?format=text`}
                download="inkloom-published.txt"
              >
                导出定稿正文（TXT）
              </a>
              {q.data.chapters.map((c) => (
                <details key={c.publicationId} className="live-book-details">
                  <summary>
                    第 {c.number} 章 · {c.title} · v{c.version}
                  </summary>
                  <Badge tone={c.current ? 'success' : 'warning'}>
                    {c.current ? '当前定稿' : '历史定稿'}
                  </Badge>
                  {!c.current && <p>{c.reason}</p>}
                  <p>
                    已确认事实 {c.facts.length} 条 · 审查意见 {c.findings.length} 条 · 作者保留{' '}
                    {c.keptFindings?.length ?? 0} 条
                  </p>
                  <p className="muted">记录实际审查结果与作者判断，未生成综合评分。</p>
                  {c.findings.map((f) => (
                    <article key={`${f.critic}/${f.id}`}>
                      <Badge>{f.severity}</Badge>{' '}
                      <strong>
                        {(c.keptFindings ?? []).includes(`${f.critic}/${f.id}`)
                          ? '作者已判断保留'
                          : '审查记录'}
                      </strong>
                      <blockquote>{f.quote}</blockquote>
                      <p>{f.reason}</p>
                    </article>
                  ))}
                  <Link to={liveWorkspacePath(c.chapterId, 'assembly')}>打开章节与定稿</Link>
                </details>
              ))}
            </>
          )}
        </>
      )}
    </Card>
  );
}
