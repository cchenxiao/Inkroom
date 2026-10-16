import { useEffect, useRef } from 'react';
import { useUIStore } from '@/shared/lib/ui-store';
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
  const theme = useUIStore((s) => s.theme);
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType>();
  useEffect(() => {
    let stopped = false;
    const el = ref.current;
    if (!el) return;
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
  }, [option, theme]);
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
