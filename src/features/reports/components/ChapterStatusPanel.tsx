import type { LiveReports } from '../useLiveReports';
import { livePreparePath, liveWorkspacePath } from '@/shared/lib/writing-mode';
import { ArrowUpRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTree, useBible } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { Button, Badge, Card, AsyncState } from '@/shared/ui';
import { pages as t } from '@/shared/lib/messages-pages';
import { zh } from '@/shared/lib/messages';
export default function ChapterStatusPanel({
  section = 'overview',
  live,
}: {
  section?: string;
  live?: LiveReports;
}) {
  const tree = useTree(!live);
  const bible = useBible(!live);
  const navigate = useNavigate();
  const overdue =
    bible.data?.foreshadows.filter((item) => item.overdue && item.status === 'open') ?? [];
  const jump = (chapterId: string, segmentId?: string) => {
    useUIStore.getState().setChapter(chapterId);
    if (segmentId) useUIStore.getState().selectSegment(segmentId);
    navigate('/workspace');
  };
  const chapterLabel = (id: string) => tree.data?.find((ch) => ch.id === id)?.title ?? id;
  if (live)
    return (
      <div className="report-status-grid">
        {section === 'foreshadow' ? (
          <Card>
            <h2>伏笔追踪</h2>
            <p>当前作品尚未建立正式的伏笔埋设与回收记录，不能从事实台账推算回收率。</p>
            <Button
              onClick={() =>
                navigate(liveWorkspacePath(live.book.data?.currentChapterId) + '&panel=bible')
              }
            >
              查看故事设定
            </Button>
          </Card>
        ) : (
          <>
            <section aria-label={t.reports.chapterStructure}>
              <div className="section-title">
                <h2>{t.reports.chapterStructure}</h2>
                <Badge tone="muted">{live.book.data?.chapters.length ?? 0}</Badge>
              </div>
              <div className="table-scroll">
                <table className="report-table chapter-report-table">
                  <thead>
                    <tr>
                      {['章节', '状态', '当前字数 / 目标', '段落采用', '审查意见', '下一步'].map(
                        (x) => (
                          <th key={x}>{x}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {live.book.data?.chapters.map((ch) => {
                      const q = live.quality.data?.chapters.find((c) => c.chapterId === ch.id);
                      const path = ch.totalBeats
                        ? liveWorkspacePath(
                            ch.id,
                            ch.doneBeats === ch.totalBeats ? 'assembly' : 'write',
                          )
                        : livePreparePath('outline', ch.id);
                      return (
                        <tr key={ch.id}>
                          <td>
                            <Button variant="ghost" size="sm" onClick={() => navigate(path)}>
                              <span className="mono">{String(ch.number).padStart(2, '0')}</span>
                              {ch.title}
                              <ArrowUpRight size={12} />
                            </Button>
                          </td>
                          <td>
                            <Badge tone={ch.status === 'finalized' ? 'success' : 'muted'}>
                              {ch.status === 'stale' ? '待更新' : zh.status[ch.status]}
                            </Badge>
                          </td>
                          <td>
                            {q?.words ?? 0} / {ch.targetWords}
                            {(q?.words ?? 0) > ch.targetWords && (
                              <small className="muted"> · 超出目标</small>
                            )}
                          </td>
                          <td>
                            {ch.doneBeats} / {ch.totalBeats}
                          </td>
                          <td>{q?.findings.length ?? 0}</td>
                          <td>
                            <Button size="sm" variant="ghost" onClick={() => navigate(path)}>
                              {ch.status === 'finalized'
                                ? '查看定稿'
                                : ch.totalBeats
                                  ? '继续创作'
                                  : '完善细纲'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <div className="section-title">
                <h2>定稿与整章复审</h2>
              </div>
              <div className="sample-grid">
                {live.archive.data?.chapters.map((ch) => (
                  <Card key={ch.publicationId}>
                    <h3>
                      第 {ch.number} 章 · {ch.title}
                    </h3>
                    <Badge tone={ch.current ? 'success' : 'muted'}>
                      {ch.current ? '当前定稿' : '历史定稿'} · v{ch.version}
                    </Badge>
                    <p>
                      {ch.findings.length} 条复审意见 · {ch.facts?.length ?? 0} 条确认事实
                    </p>
                    <details>
                      <summary>查看复审意见与作者判断</summary>
                      {ch.findings.length ? (
                        ch.findings.map((f) => (
                          <article key={f.critic + '/' + f.id}>
                            <blockquote>{f.quote}</blockquote>
                            <p>{f.reason}</p>
                            {ch.keptFindings?.includes(f.critic + '/' + f.id) && (
                              <Badge tone="human">作者保留</Badge>
                            )}
                          </article>
                        ))
                      ) : (
                        <p>本次复审没有记录问题，不代表已证明不存在问题。</p>
                      )}
                    </details>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(liveWorkspacePath(ch.chapterId, 'assembly'))}
                    >
                      查看章节定稿
                    </Button>
                  </Card>
                ))}
              </div>
              {!live.archive.data?.chapters.length && <p>尚无已定稿章节。</p>}
            </section>
          </>
        )}
      </div>
    );
  return (
    <div className="report-status-grid">
      {section === 'overview' && (
        <section aria-label={t.reports.chapterStructure}>
          <div className="section-title">
            <h2>{t.reports.chapterStructure}</h2>
            <Badge tone="muted">{tree.data?.length ?? 0}</Badge>
          </div>
          <AsyncState
            loading={tree.isLoading}
            error={tree.error}
            onRetry={() => tree.refetch()}
            empty={!tree.data?.length}
          >
            <div className="table-scroll">
              <table className="report-table chapter-report-table">
                <thead>
                  <tr>
                    {[
                      t.common.chapter,
                      t.reports.status,
                      t.common.version,
                      t.reports.words,
                      t.reports.sceneBeats,
                      t.reports.issues,
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tree.data?.map((ch) => {
                    const beats = ch.scenes.flatMap((scene) => scene.beats);
                    return (
                      <tr key={ch.id}>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${t.reports.openChapter} ${ch.title}`}
                            onClick={() => jump(ch.id)}
                          >
                            <span className="mono">{String(ch.number).padStart(2, '0')}</span>
                            {ch.title}
                            <ArrowUpRight size={12} />
                          </Button>
                        </td>
                        <td>
                          <Badge
                            tone={
                              ch.status === 'finalized'
                                ? 'success'
                                : ch.status === 'human'
                                  ? 'human'
                                  : ch.status === 'revising'
                                    ? 'warning'
                                    : 'muted'
                            }
                          >
                            {zh.status[ch.status]}
                          </Badge>
                        </td>
                        <td>v{ch.draftVersion}</td>
                        <td>{ch.wordCount.toLocaleString()}</td>
                        <td>
                          {ch.scenes.length} /{' '}
                          {beats.filter((beat) => beat.status === 'done').length}·{beats.length}
                        </td>
                        <td>
                          <Badge tone={ch.issueCount ? 'warning' : 'muted'}>{ch.issueCount}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </AsyncState>
        </section>
      )}
      {section === 'foreshadow' && (
        <section aria-label={t.reports.overdue}>
          <div className="section-title">
            <h2>{t.reports.overdue}</h2>
            <Badge tone={overdue.length ? 'foreshadow' : 'success'}>{overdue.length}</Badge>
          </div>
          <AsyncState loading={bible.isLoading} error={bible.error} onRetry={() => bible.refetch()}>
            <div className="page-stack">
              {overdue.length ? (
                overdue.map((item) => (
                  <Card className="overdue-foreshadow" key={item.id}>
                    <div className="page-row">
                      <h3>{item.title}</h3>
                      <Badge tone="warning">{t.bible.overdue}</Badge>
                    </div>
                    <p>{item.payload}</p>
                    <small>
                      {t.bible.planted} · {chapterLabel(item.plantedChapter)}
                      <br />
                      {t.bible.resolve} · {chapterLabel(item.planResolveChapter)}
                    </small>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${t.common.locate} ${item.title}`}
                      onClick={() => jump(item.plantedChapter, item.plantedSegment)}
                    >
                      {t.common.locate}
                      <ArrowUpRight size={12} />
                    </Button>
                  </Card>
                ))
              ) : (
                <Card className="quiet">
                  <Check size={14} />
                  {t.reports.noOverdue}
                </Card>
              )}
            </div>
          </AsyncState>
        </section>
      )}
    </div>
  );
}
