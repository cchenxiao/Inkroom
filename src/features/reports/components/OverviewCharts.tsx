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
}: {
  data: ReportOverview;
  section: string;
  onSample: (id: string) => void;
}) {
  const tree = useTree();
  const navigate = useNavigate();
  const chapterFor = (label: string) =>
    tree.data?.find((ch) => `第${ch.number}章 ${ch.title}` === label);
  return (
    <>
      {section === 'style' && (
        <>
          <Card className="chart-card">
            <div className="page-row">
              <h2>{t.reports.style}</h2>
              <Badge tone="muted">{t.reports.lowerBetter}</Badge>
            </div>
            <Chart
              height={280}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { data: [t.reports.styleLegend, t.reports.aiLegend], bottom: 0 },
                grid: { left: 40, right: 20, top: 30, bottom: 60 },
                xAxis: {
                  type: 'category',
                  data: data.chapterStats.map((c) => c.chapter),
                  boundaryGap: false,
                },
                yAxis: { type: 'value', min: 0, max: 1 },
                series: [
                  {
                    name: t.reports.styleLegend,
                    type: 'line',
                    smooth: true,
                    data: data.chapterStats.map((c) => c.style),
                    areaStyle: { opacity: 0.08 },
                  },
                  {
                    name: t.reports.aiLegend,
                    type: 'line',
                    smooth: true,
                    data: data.chapterStats.map((c) => c.aiTaste),
                  },
                ],
              }}
            />
          </Card>
          <div className="report-chart-grid">
            <Card className="chart-card">
              <h2>{t.reports.voice}</h2>
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
      {['overview', 'foreshadow'].includes(section) && <ChapterStatusPanel section={section} />}
      {section === 'ai' && (
        <>
          <Card className="ai-heat-card">
            <div className="page-row">
              <h2>{e.reports.heatTitle}</h2>
              <Badge tone="muted">{e.reports.uncalibrated}</Badge>
            </div>
            <p className="quiet">{e.reports.heatHint}</p>
            <div className="ai-heat-grid">
              {data.chapterStats.map((ch) => (
                <button
                  className="ai-heat-cell"
                  key={ch.chapter}
                  aria-label={`${e.reports.openHeat} ${ch.chapter}`}
                  disabled={!chapterFor(ch.chapter)}
                  onClick={() => {
                    const chapter = chapterFor(ch.chapter);
                    if (!chapter) return;
                    useUIStore.getState().setChapter(chapter.id);
                    useUIStore.getState().setHeatmap(true);
                    navigate('/workspace');
                  }}
                >
                  <small>{ch.chapter}</small>
                  <strong>{ch.aiTaste.toFixed(2)}</strong>
                  <meter min={0} max={1} value={ch.aiTaste} aria-label={`${ch.chapter} AI 味`} />
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
