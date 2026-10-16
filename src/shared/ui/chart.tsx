import { useEffect, useRef } from 'react';
import { useUIStore } from '@/shared/lib/ui-store';
import { EmptyState } from './index';
import type { EChartsOption } from 'echarts';
import type { EChartsType } from 'echarts/core';
/** 按可见区域加载 ECharts；团队色板作为主题，业务组件只传数据。 */
export function Chart({
  option,
  height = 220,
  className,
}: {
  option: EChartsOption;
  height?: number;
  className?: string;
}) {
  const series = (
    Array.isArray(option.series) ? option.series : option.series ? [option.series] : []
  ) as {
    type?: string;
    data?: unknown[];
    links?: unknown[];
    edges?: unknown[];
  }[];
  const empty = !series.length || series.every((s) => !s.data?.some((value) => value != null));
  const missingRelations =
    series.some((s) => s.type === 'graph') &&
    series.filter((s) => s.type === 'graph').every((s) => !(s.links?.length || s.edges?.length));
  const theme = useUIStore((s) => s.theme);
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType>();
  useEffect(() => {
    let stopped = false;
    const el = ref.current;
    if (!el || empty || missingRelations) return;
    let observer: ResizeObserver | undefined;
    const visibility = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || chart.current) return;
      void import('@/shared/lib/echarts').then((echarts) => {
        if (stopped || chart.current) return;
        const styles = getComputedStyle(document.documentElement);
        const color = (name: string) => styles.getPropertyValue(`--${name}`).trim();
        const axis = {
          axisLine: { lineStyle: { color: color('border') } },
          axisLabel: { color: color('text-dim'), fontSize: 10 },
          splitLine: { lineStyle: { color: color('border') } },
          axisTick: { show: false },
        };
        chart.current = echarts.init(
          el,
          {
            color: ['ai', 'human', 'p1', 'p2', 'foreshadow', 'p0'].map(color),
            backgroundColor: 'transparent',
            textStyle: { color: color('text-dim') },
            title: { textStyle: { color: color('text') } },
            legend: { textStyle: { color: color('text-dim') } },
            categoryAxis: axis,
            valueAxis: axis,
            radar: {
              axisName: { color: color('text-dim'), fontSize: 10 },
              axisLine: { lineStyle: { color: color('border') } },
              splitLine: { lineStyle: { color: color('border') } },
              splitArea: { show: false },
            },
            tooltip: {
              backgroundColor: color('overlay'),
              borderColor: color('border'),
              textStyle: { color: color('text') },
            },
          },
          { renderer: 'svg' },
        );
        chart.current.setOption({ ...option, backgroundColor: 'transparent' });
        observer = new ResizeObserver(() => chart.current?.resize());
        observer.observe(el);
      });
    });
    visibility.observe(el);
    return () => {
      stopped = true;
      visibility.disconnect();
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = undefined;
    };
  }, [option, theme, empty, missingRelations]);
  if (empty || missingRelations)
    return (
      <EmptyState
        compact
        title={missingRelations ? '人物关系尚未建立' : '暂无评测数据'}
        description={
          missingRelations
            ? '确认人物关系后再展示关系图；孤立人物可在人物列表查看。'
            : '完成正文并运行对应评测后，这里会显示结果。'
        }
      />
    );
  return (
    <div
      ref={ref}
      className={className}
      style={{ height, width: '100%', minWidth: 0 }}
      role="img"
      aria-label="数据可视化图表"
    />
  );
}
