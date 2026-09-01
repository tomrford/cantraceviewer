import { defineChart, lineY, type ChartMarkRenderer } from '@tanstack/charts';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { FALLBACK_PLOT_THEME } from '$lib/plot-theme.js';
import { PRIMARY_Y_AXIS_ID } from '$lib/plot-axes.js';
import { plotGrid } from '$lib/plot-axis-layout.js';
import type { SpikeSeries, SpikeViewport, SpikeWorkload } from './workload.js';

const DEFINITION_OPTIONS = {
	keyboard: false,
	pointer: false,
	focus: false as const,
	focusRing: false,
	tooltip: false as const,
	svgAnimation: false,
	motion: false as const
};

export function createTanstackMarks(workload: SpikeWorkload, renderer?: ChartMarkRenderer) {
	return workload.series.map((series) => tanstackLine(workload.indexes, series, renderer));
}

export function createTanstackDefinition(
	marks: ReturnType<typeof createTanstackMarks>,
	workload: SpikeWorkload,
	viewport: SpikeViewport
) {
	const grid = plotGrid(2);
	const theme = FALLBACK_PLOT_THEME;
	return defineChart(
		{
			marks,
			scales: {
				x: {
					scale: () => scaleLinear().domain([workload.xMin, workload.xMax]),
					viewport: { domain: [viewport.xMin, viewport.xMax] },
					grid: true
				},
				y: {
					scale: () => scaleLinear().domain([viewport.primary.min, viewport.primary.max]),
					grid: true,
					axis: { label: 'Primary' }
				},
				y2: {
					channel: 'y',
					scale: () => scaleLinear().domain([viewport.secondary.min, viewport.secondary.max]),
					side: 'left',
					axis: { label: 'Secondary' }
				}
			},
			clip: true,
			margin: { left: grid.left, right: grid.right, top: grid.top, bottom: grid.bottom },
			theme: {
				foreground: theme.text,
				muted: theme.text,
				grid: theme.gridLine,
				background: theme.background
			}
		},
		DEFINITION_OPTIONS
	);
}

function tanstackLine(
	indexes: readonly number[],
	series: SpikeSeries,
	renderer: ChartMarkRenderer | undefined
) {
	return lineY(indexes, {
		id: series.key,
		x: (index) => series.x[index],
		y: (index) => series.y[index],
		stroke: series.color,
		strokeWidth: 2.5,
		strokeOpacity: 0.95,
		renderer,
		...(series.yAxis === PRIMARY_Y_AXIS_ID ? {} : { yScale: series.yAxis })
	});
}
