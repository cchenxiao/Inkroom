import { ArrowUpRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTree, useBible } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { Button, Badge, Card, AsyncState } from '@/shared/ui';
import { pages as t } from '@/shared/lib/messages-pages';
import { zh } from '@/shared/lib/messages';
export default function ChapterStatusPanel({ section = 'overview' }: { section?: string }) {
  const tree = useTree();
  const bible = useBible();
  const navigate = useNavigate();
  const overdue =
    bible.data?.foreshadows.filter((item) => item.overdue && item.status === 'open') ?? [];
  const jump = (chapterId: string, segmentId?: string) => {
    useUIStore.getState().setChapter(chapterId);
    if (segmentId) useUIStore.getState().selectSegment(segmentId);
    navigate('/workspace');
  };
  const chapterLabel = (id: string) => tree.data?.find((ch) => ch.id === id)?.title ?? id;
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
