import type { ChartGPUInstance, ChartGPUOptions, ThemeConfig } from 'chartgpu';

import { AXIS_FONT_SIZE, Y_TICK_COUNT } from '@/lib/plot/plot-axis-layout';
import { checkWebGpuSupport, type PlotBackend, type PlotFrame } from '@/lib/plot/plot-backend';
import { SIGNAL_COLORS } from '@/lib/plot/plot-colors';
import { emptyAxisSeries, type PlotSeriesConfig, plotSeriesForViews } from '@/lib/plot/plot-series';
import type { PlotTheme } from '@/lib/plot/plot-theme';
import { formatAxisTime, type WindowedSignalView } from '@/lib/plot/signal-plot-data';
import { PRIMARY_Y_AXIS_ID, type YAxisId } from '@/lib/plot/y-axis';
import { appStore } from '@/store/store';

/** Fetches the ChartGPU chunk only when WebGPU is actually usable. */
export function preloadWebGpuBackend(): void {
	const known = appStore.getState().plotRenderer;
	if (known?.kind === 'canvas') return;
	if (known?.kind === 'webgpu') {
		void import('chartgpu').catch(() => undefined);
		return;
	}
	void checkWebGpuSupport().then((support) => {
		if (support.ok) void import('chartgpu').catch(() => undefined);
	});
}

/**
 * Starts ChartGPU on `surface` behind the shared `PlotBackend` contract. Reuses per-series
 * objects whenever views and axis assignments are unchanged so ChartGPU keeps its GPU buffers.
 */
export async function createWebGpuBackend(
	surface: HTMLElement,
	initialFrame: PlotFrame,
	isDisposed?: () => boolean
): Promise<PlotBackend | null> {
	const mod = await import('chartgpu');
	if (isDisposed?.()) return null;
	let themeCache: { source: PlotTheme; config: ThemeConfig } | null = null;
	let seriesCache: {
		views: readonly WindowedSignalView[];
		axisIdByKey: ReadonlyMap<string, YAxisId>;
		series: PlotSeriesConfig[];
	} | null = null;

	function toOptions(frame: PlotFrame): ChartGPUOptions {
		if (themeCache?.source !== frame.theme) {
			themeCache = { source: frame.theme, config: chartTheme(frame.theme) };
		}
		if (seriesCache?.views !== frame.views || seriesCache.axisIdByKey !== frame.axisIdByKey) {
			const series = plotSeriesForViews(
				frame.views,
				(view) => frame.axisIdByKey.get(view.signal.key) ?? PRIMARY_Y_AXIS_ID
			);
			seriesCache = {
				views: frame.views,
				axisIdByKey: frame.axisIdByKey,
				series: series.length > 0 ? series : [emptyAxisSeries(PRIMARY_Y_AXIS_ID)]
			};
		}
		return chartOptions(themeCache.config, frame, seriesCache.series);
	}

	const chart: ChartGPUInstance = await mod.ChartGPU.create(surface, toOptions(initialFrame));
	if (isDisposed?.()) {
		chart.dispose();
		return null;
	}
	let disposed = false;

	return {
		kind: 'webgpu',
		render(frame) {
			if (!disposed) chart.setOption(toOptions(frame));
		},
		resize() {
			if (!disposed) chart.resize();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			chart.dispose();
		}
	};
}

function chartTheme(theme: PlotTheme): ThemeConfig {
	return {
		backgroundColor: theme.background,
		textColor: theme.text,
		axisLineColor: theme.axisLine,
		axisTickColor: theme.axisTick,
		gridLineColor: theme.gridLine,
		colorPalette: SIGNAL_COLORS,
		fontFamily: theme.fontFamily,
		fontSize: AXIS_FONT_SIZE
	};
}

function chartOptions(
	theme: ThemeConfig,
	frame: PlotFrame,
	series: PlotSeriesConfig[]
): ChartGPUOptions {
	const time = frame.timeFormat;
	return {
		performance: { lod: 'strict' },
		theme,
		grid: frame.grid,
		gridLines: { color: frame.theme.gridLine, opacity: 1 },
		xAxis: {
			type: 'time',
			min: frame.xRange?.min,
			max: frame.xRange?.max,
			tickFormatter: (value) => formatAxisTime(value, time)
		},
		axes: {
			y: frame.axes.map((axis) => ({
				id: axis.id,
				type: 'value' as const,
				position: 'left' as const,
				min: frame.axisRanges.get(axis.id)?.min,
				max: frame.axisRanges.get(axis.id)?.max,
				tickCount: Y_TICK_COUNT,
				tickFormatter: () => null
			}))
		},
		legend: { show: false },
		tooltip: { show: false },
		animation: false,
		palette: SIGNAL_COLORS,
		annotations: [],
		series
	};
}
