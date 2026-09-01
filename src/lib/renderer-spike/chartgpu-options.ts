import type { ChartGPUOptions, SeriesConfig } from 'chartgpu';
import { plotGrid } from '$lib/plot-axis-layout.js';
import { FALLBACK_PLOT_THEME } from '$lib/plot-theme.js';
import { SIGNAL_COLORS } from '$lib/plot-colors.js';
import type { SpikeViewport, SpikeWorkload } from './workload.js';

/** Frozen ChartGPU series objects. Domain-only updates keep this array identity. */
export function chartgpuSeries(workload: SpikeWorkload): SeriesConfig[] {
	return workload.series.map((series) => ({
		type: 'line',
		name: series.label,
		data: { x: series.x, y: series.y },
		yAxis: series.yAxis,
		color: series.color,
		lineStyle: { color: series.color, width: 2.5, opacity: 0.95 },
		sampling: 'none',
		samplingThreshold: series.points - 1
	}));
}

export function chartgpuOptions(series: SeriesConfig[], viewport: SpikeViewport): ChartGPUOptions {
	const theme = FALLBACK_PLOT_THEME;
	return {
		theme: {
			backgroundColor: theme.background,
			textColor: theme.text,
			axisLineColor: theme.axisLine,
			axisTickColor: theme.axisTick,
			gridLineColor: theme.gridLine,
			colorPalette: SIGNAL_COLORS,
			fontFamily: theme.fontFamily,
			fontSize: 12
		},
		grid: plotGrid(2),
		gridLines: { color: theme.gridLine, opacity: 1 },
		xAxis: {
			type: 'time',
			min: viewport.xMin,
			max: viewport.xMax
		},
		axes: {
			y: [
				{
					id: 'y',
					type: 'value',
					position: 'left',
					min: viewport.primary.min,
					max: viewport.primary.max,
					tickFormatter: () => null
				},
				{
					id: 'y2',
					type: 'value',
					position: 'left',
					min: viewport.secondary.min,
					max: viewport.secondary.max,
					tickFormatter: () => null
				}
			]
		},
		legend: { show: false },
		tooltip: { show: false },
		animation: false,
		palette: SIGNAL_COLORS,
		annotations: [],
		series
	};
}
