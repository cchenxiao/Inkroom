import ChapterStatusPanel from './ChapterStatusPanel';
import { Badge, Card, Chart } from '@/shared/ui';
import { pages as t } from '@/shared/lib/messages-pages';
import type { ReportOverview } from '@/types/domain';
export default function OverviewCharts({ data }: { data: ReportOverview }) {
  return (
    <>
      <div className="report-metrics">
        <Card>
          <small>{t.reports.words}</small>
          <strong>
            {data.chapterStats.reduce((sum, ch) => sum + ch.words, 0).toLocaleString()}
          </strong>
          <span>{t.reports.wordsUnit}</span>
        </Card>
        <Card>
          <small>{t.reports.chapters}</small>
          <strong>{data.chapterStats.length.toString().padStart(2, '0')}</strong>
          <span>{t.common.chapter}</span>
        </Card>
        <Card>
          <small>{t.reports.foreshadow}</small>
          <strong>
            {Math.round(data.foreshadowRate <= 1 ? data.foreshadowRate * 100 : data.foreshadowRate)}
            <i>%</i>
          </strong>
          <span>{t.bible.tabs.foreshadows}</span>
        </Card>
        <Card>
          <small>{t.reports.aiTaste}</small>
          <strong>
            {data.chapterStats.length
              ? (
                  data.chapterStats.reduce((sum, ch) => sum + ch.aiTaste, 0) /
                  data.chapterStats.length
                ).toFixed(2)
              : '—'}
          </strong>
          <span>{t.reports.calibration}</span>
        </Card>
      </div>
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
                {v.name} · {v.calibrated ? t.review.passed : t.reports.calibration}
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
      <ChapterStatusPanel />
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
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
