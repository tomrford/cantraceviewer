import type { LineSeriesConfig, ScatterSeriesConfig } from 'chartgpu';
import type { YAxisId } from './plot-axes.js';
import type { WindowedSignalView } from './signal-plot-data.js';

const EMPTY_SERIES = new Float64Array(0);

export function lineSeries(view: WindowedSignalView, yAxis: YAxisId): LineSeriesConfig {
	return {
		type: 'line',
		name: view.label,
		data: { x: view.x, y: view.y },
		yAxis,
		color: view.color,
		lineStyle: { color: view.color, width: 2.5, opacity: 0.95 },
		sampling: 'none'
	};
}

function sampleMarkerSeries(view: WindowedSignalView, yAxis: YAxisId): ScatterSeriesConfig {
	return {
		type: 'scatter',
		name: view.label,
		data: { x: view.x, y: view.y },
		yAxis,
		color: view.color,
		symbolSize: 1.5,
		sampling: 'none'
	};
}

export type PlotSeriesConfig = LineSeriesConfig | ScatterSeriesConfig;

export function plotSeriesForViews(
	views: WindowedSignalView[],
	yAxisFor: (view: WindowedSignalView) => YAxisId
): PlotSeriesConfig[] {
	return views.flatMap((view) => {
		if (view.points === 0) return [];
		const yAxis = yAxisFor(view);
		const line = lineSeries(view, yAxis);
		return view.sampled ? [line] : [line, sampleMarkerSeries(view, yAxis)];
	});
}

export function emptyAxisSeries(yAxis: YAxisId): LineSeriesConfig {
	return {
		type: 'line',
		data: { x: EMPTY_SERIES, y: EMPTY_SERIES },
		yAxis,
		visible: false,
		sampling: 'none'
	};
}
