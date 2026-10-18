import type { LiveReports } from '../useLiveReports';
import { liveWorkspacePath } from '@/shared/lib/writing-mode';
import { editorialPages as e } from '@/shared/lib/messages-editorial-pages';
import { useNavigate } from 'react-router-dom';
import { useTree } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import ChapterStatusPanel from './ChapterStatusPanel';
import { Badge, Button, Card, Chart } from '@/shared/ui';
import { pages as t } from '@/shared/lib/messages-pages';
import type { ReportOverview } from '@/types/domain';
export default function OverviewCharts({
  data,
  section,
  onSample,
  live,
}: {
  live?: LiveReports;
  data: ReportOverview;
  section: string;
  onSample: (id: string) => void;
}) {
  const tree = useTree(!live);
  const navigate = useNavigate();
  const chapterFor = (label: string) =>
    tree.data?.find((ch) => `第${ch.number}章 ${ch.title}` === label);
  return (
    <>
      {section === 'style' && (
        <>
          <Card className="chart-card">
            <div className="page-row">
              <h2>{live ? '章节句长与变化' : t.reports.style}</h2>
              <Badge tone="muted">{live ? '文本统计 · 非质量评分' : t.reports.lowerBetter}</Badge>
            </div>
            <Chart
              height={280}
              option={{
                tooltip: { trigger: 'axis' },
                legend: {
                  data: live
                    ? ['平均句长', '句长标准差']
                    : [t.reports.styleLegend, t.reports.aiLegend],
                  bottom: 0,
                },
                grid: { left: 40, right: 20, top: 30, bottom: 60 },
                xAxis: {
                  type: 'category',
                  data: data.chapterStats.map((c) => c.chapter),
                  boundaryGap: false,
                },
                yAxis: { type: 'value', min: 0, ...(live ? {} : { max: 1 }) },
                series: [
                  {
                    name: live ? '平均句长' : t.reports.styleLegend,
                    type: 'line',
                    smooth: true,
                    data: live
                      ? live.quality.data?.chapters.map((c) => (c.words ? c.statistics.mean : null))
                      : data.chapterStats.map((c) => c.style),
                    areaStyle: { opacity: 0.08 },
                  },
                  {
                    name: live ? '句长标准差' : t.reports.aiLegend,
                    type: 'line',
                    smooth: true,
                    data: live
                      ? live.quality.data?.chapters.map((c) =>
                          c.words ? Math.sqrt(c.statistics.variance) : null,
                        )
                      : data.chapterStats.map((c) => c.aiTaste),
                  },
                ],
              }}
            />
          </Card>
          <div className="report-chart-grid">
            <Card className="chart-card">
              <h2>{t.reports.voice}</h2>
              {live && <p className="quiet">尚无人物声线校准结果，不从句长统计推算雷达评分。</p>}
              <Chart
                height={290}
                option={{
                  legend: { bottom: 0, data: data.voiceScores.map((v) => v.name) },
                  radar: {
                    indicator: t.bible.radar.map((name) => ({ name, max: 100 })),
                    radius: '61%',
                    center: ['50%', '43%'],
                  },
                  series: [
                    {
                      type: 'radar',
                      data: data.voiceScores.map((v) => ({ name: v.name, value: v.values })),
                      areaStyle: { opacity: 0.06 },
                    },
                  ],
                }}
              />
              <div className="voice-tags">
                {data.voiceScores.map((v) => (
                  <Badge key={v.name} tone={v.calibrated ? 'success' : 'muted'}>
                    {v.name} · {v.calibrated ? t.review.passed : e.reports.uncalibrated}
                  </Badge>
                ))}
              </div>
            </Card>
            <Card className="chart-card">
              <h2>{t.reports.sentences}</h2>
              <Chart
                height={290}
                option={{
                  tooltip: { trigger: 'axis' },
                  grid: { left: 40, right: 20, top: 30, bottom: 40 },
                  xAxis: {
                    type: 'category',
                    data: data.sentenceDistribution.map((v) => v.range),
                  },
                  yAxis: { type: 'value' },
                  series: [
                    {
                      type: 'bar',
                      barWidth: '45%',
                      data: data.sentenceDistribution.map((v) => v.count),
                      itemStyle: { borderRadius: [4, 4, 0, 0] },
                    },
                  ],
                }}
              />
            </Card>
          </div>
        </>
      )}
      {['overview', 'foreshadow'].includes(section) && (
        <ChapterStatusPanel section={section} live={live} />
      )}
      {section === 'ai' && (
        <>
          <Card className="ai-heat-card">
            <div className="page-row">
              <h2>{e.reports.heatTitle}</h2>
              <Badge tone="muted">{e.reports.uncalibrated}</Badge>
            </div>
            <p className="quiet">
              {live
                ? '展示当前正文中已保存的 AI 味审查意见数量，不是 AI 生成概率或质量分数。点击章节查看原文。'
                : e.reports.heatHint}
            </p>
            <div className="ai-heat-grid">
              {data.chapterStats.map((ch) => (
                <button
                  className="ai-heat-cell"
                  key={ch.chapter}
                  aria-label={`${e.reports.openHeat} ${ch.chapter}`}
                  disabled={
                    live
                      ? !live.quality.data?.chapters[data.chapterStats.indexOf(ch)]?.words
                      : !chapterFor(ch.chapter)
                  }
                  onClick={() => {
                    if (live) {
                      const c = live.quality.data?.chapters[data.chapterStats.indexOf(ch)];
                      if (c) navigate(liveWorkspacePath(c.chapterId) + '&panel=review');
                      return;
                    }
                    const chapter = chapterFor(ch.chapter);
                    if (!chapter) return;
                    useUIStore.getState().setChapter(chapter.id);
                    useUIStore.getState().setHeatmap(true);
                    navigate('/workspace');
                  }}
                >
                  <small>{ch.chapter}</small>
                  <strong>
                    {live
                      ? `${live.quality.data?.chapters[data.chapterStats.indexOf(ch)]?.findings.filter((f) => f.critic === 'ai_taste').length ?? 0} 条意见`
                      : (ch.aiTaste?.toFixed(2) ?? '—')}
                  </strong>
                  {!live && ch.aiTaste !== null && (
                    <meter min={0} max={1} value={ch.aiTaste} aria-label={`${ch.chapter} AI 味`} />
                  )}
                  <small>{e.reports.openManuscript}</small>
                </button>
              ))}
            </div>
          </Card>
          <section className="page-section">
            <div className="section-title">
              <h2>{t.reports.evidence}</h2>
            </div>
            <div className="sample-grid">
              {data.samples.map((sample) => (
                <Card key={sample.id}>
                  <h3>{sample.title}</h3>
                  <blockquote>{sample.quote}</blockquote>
                  <p>{sample.reason}</p>
                  {sample.kept && <Badge tone="human">作者已保留</Badge>}
                  <Button variant="ghost" size="sm" onClick={() => onSample(sample.id)}>
                    {e.reports.evidence}
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
