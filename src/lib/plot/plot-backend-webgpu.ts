import type {
	ChartGPUCreateContext,
	ChartGPUInstance,
	ChartGPUOptions,
	ThemeConfig
} from 'chartgpu';

import { AXIS_FONT_SIZE, Y_TICK_COUNT } from '@/lib/plot/plot-axis-layout';
import {
	checkWebGpuSupport,
	type PlotBackend,
	type PlotFrame,
	type WebGpuAdapter
} from '@/lib/plot/plot-backend';
import { SIGNAL_COLORS } from '@/lib/plot/plot-colors';
import { emptyAxisSeries, type PlotSeriesConfig, plotSeriesForViews } from '@/lib/plot/plot-series';
import type { PlotTheme } from '@/lib/plot/plot-theme';
import { formatAxisTime, type WindowedSignalView } from '@/lib/plot/signal-plot-data';
import { PRIMARY_Y_AXIS_ID, type YAxisId } from '@/lib/plot/y-axis';

/** Fetches the ChartGPU chunk only when WebGPU is actually usable. */
export function preloadWebGpuBackend(): void {
	void checkWebGpuSupport().then((support) => {
		if (support.ok) void import('chartgpu').catch(() => undefined);
	});
}

/**
 * Starts ChartGPU on `surface` with an app-owned WebGPU device so unexpected device loss is
 * reliably observed both during startup and active rendering. Reuses per-series objects whenever
 * views and axis assignments are unchanged so ChartGPU keeps its GPU buffers intact.
 */
export async function createWebGpuBackend(
	surface: HTMLElement,
	initialFrame: PlotFrame,
	adapter: WebGpuAdapter,
	onDeviceLost?: () => void
): Promise<PlotBackend> {
	const [modResult, deviceResult] = await Promise.allSettled([
		import('chartgpu'),
		adapter.requestDevice()
	]);
	if (modResult.status === 'rejected') {
		if (deviceResult.status === 'fulfilled') deviceResult.value.destroy();
		throw modResult.reason;
	}
	if (deviceResult.status === 'rejected') throw deviceResult.reason;
	const mod = modResult.value;
	const device = deviceResult.value;
	let themeCache: { source: PlotTheme; resolved: ChartTheme } | null = null;
	let seriesCache: {
		views: readonly WindowedSignalView[];
		axisIdByKey: ReadonlyMap<string, YAxisId>;
		series: PlotSeriesConfig[];
	} | null = null;

	function toOptions(frame: PlotFrame): ChartGPUOptions {
		if (themeCache?.source !== frame.theme) {
			themeCache = { source: frame.theme, resolved: chartTheme(frame.theme) };
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
		return chartOptions(themeCache.resolved, frame, seriesCache.series);
	}

	let disposed = false;
	let lostBeforeReady = false;
	let ready = false;
	void device.lost.then((info) => {
		if (disposed || info.reason === 'destroyed') return;
		console.warn('WebGPU device lost; falling back to Canvas 2D.', info);
		if (ready) onDeviceLost?.();
		else lostBeforeReady = true;
	});

	let chart: ChartGPUInstance;
	try {
		chart = await mod.ChartGPU.create(surface, toOptions(initialFrame), {
			adapter: adapter as ChartGPUCreateContext['adapter'],
			device: device as ChartGPUCreateContext['device']
		});
	} catch (error) {
		disposed = true;
		device.destroy();
		throw error;
	}

	if (lostBeforeReady) {
		disposed = true;
		chart.dispose();
		device.destroy();
		throw new Error('WebGPU device was lost during initialization.');
	}
	ready = true;

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
			device.destroy();
		}
	};
}

type ChartTheme = { gridLine: string; config: ThemeConfig };

function chartTheme(theme: PlotTheme): ChartTheme {
	return {
		gridLine: theme.gridLine,
		config: {
			backgroundColor: theme.background,
			textColor: theme.text,
			axisLineColor: theme.axisLine,
			axisTickColor: theme.axisTick,
			gridLineColor: theme.gridLine,
			colorPalette: SIGNAL_COLORS,
			fontFamily: theme.fontFamily,
			fontSize: AXIS_FONT_SIZE
		}
	};
}

function chartOptions(
	theme: ChartTheme,
	frame: PlotFrame,
	series: PlotSeriesConfig[]
): ChartGPUOptions {
	const time = frame.timeFormat;
	return {
		performance: { lod: 'strict' },
		theme: theme.config,
		grid: frame.grid,
		gridLines: { color: theme.gridLine, opacity: 1 },
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
