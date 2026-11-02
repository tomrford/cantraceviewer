import type { ChartGPUInstance, ChartGPUOptions, ThemeConfig } from 'chartgpu';

import { PRIMARY_Y_AXIS_ID } from '@/lib/plot/plot-axes';
import { Y_TICK_COUNT, type AxisTickGenerator } from '@/lib/plot/plot-axis-layout';
import { SIGNAL_COLORS } from '@/lib/plot/plot-colors';
import { emptyAxisSeries, plotSeriesForViews, type PlotSeriesConfig } from '@/lib/plot/plot-series';
import { resolvePlotTheme, type PlotTheme } from '@/lib/plot/plot-theme';
import { PlotWindow } from '@/lib/plot/plot-window';
import { formatAxisTime, type WindowedSignalView } from '@/lib/plot/signal-plot-data';
import type { PlotModelState } from '@/stores/derive';
import { isDark } from '@/stores/preferences';
import { appStore, type AppState } from '@/stores/store';

const AXIS_FONT_SIZE = 12;

export type RendererState =
	| { status: 'loading' }
	| { status: 'ready'; generateTicks: AxisTickGenerator }
	| { status: 'error'; message: string };

/**
 * Starts ChartGPU on `surface` and pushes options from store subscriptions, coalesced to one
 * `setOption` per animation frame. Returns the teardown.
 */
export function mountChart(
	root: HTMLElement,
	surface: HTMLElement,
	onStatus: (state: RendererState) => void
): () => void {
	let disposed = false;
	let chart: ChartGPUInstance | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let frame: number | null = null;
	let themeDark = isDark(appStore.getState());
	let theme = chartTheme(resolvePlotTheme(getComputedStyle(root)));
	// ChartGPU reuses per-series state only for identical series objects, so rebuild them only
	// when the windowed views or the axis assignment change.
	let seriesCache: {
		views: WindowedSignalView[];
		model: PlotModelState;
		series: PlotSeriesConfig[];
	} | null = null;
	const plotWindow = new PlotWindow(schedule);

	function currentOptions(): ChartGPUOptions {
		// connectPreferences toggles the dark class in the same store update that scheduled this frame.
		const state = appStore.getState();
		const dark = isDark(state);
		if (dark !== themeDark) {
			themeDark = dark;
			theme = chartTheme(resolvePlotTheme(getComputedStyle(root)));
		}
		const model = state.plotModel;
		const views = plotWindow.viewsFor(model.views, state.activeViewport);
		if (seriesCache?.views !== views || seriesCache.model !== model) {
			const series = plotSeriesForViews(
				views,
				(signal) => model.axisIdByKey.get(signal.key) ?? PRIMARY_Y_AXIS_ID
			);
			seriesCache = {
				views,
				model,
				series: series.length > 0 ? series : [emptyAxisSeries(PRIMARY_Y_AXIS_ID)]
			};
		}
		return chartOptions(theme, state, seriesCache.series);
	}

	function schedule() {
		if (frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			if (chart === null) return;
			chart.setOption(currentOptions());
			plotWindow.settleAfter(
				appStore.getState().plotModel.views,
				appStore.getState().activeViewport
			);
		});
	}

	async function start() {
		try {
			const mod = await import('chartgpu').catch(() => null);
			if (disposed) return;
			if (mod === null) {
				onStatus({
					status: 'error',
					message: 'The plot renderer could not be downloaded. Reload the page to try again.'
				});
				return;
			}
			const created = await mod.ChartGPU.create(surface, currentOptions());
			if (disposed) {
				created.dispose();
				return;
			}
			chart = created;
			// Store/theme updates may have consumed their frames while create was pending.
			schedule();
			resizeObserver = new ResizeObserver(() => chart?.resize());
			resizeObserver.observe(surface);
			onStatus({ status: 'ready', generateTicks: mod.generateValueAxisTicks });
		} catch (error) {
			if (!disposed) {
				onStatus({
					status: 'error',
					message: `Could not start the plot renderer: ${error instanceof Error ? error.message : 'unknown error'}`
				});
			}
		}
	}

	// Every viewport change replaces `axisRanges`, so it alone tracks viewport changes.
	const unsubscribe = appStore.subscribe((state, previous) => {
		if (
			state.plotModel !== previous.plotModel ||
			state.axisRanges !== previous.axisRanges ||
			state.timestampMode !== previous.timestampMode ||
			isDark(state) !== isDark(previous)
		) {
			schedule();
		}
	});
	void start();

	return () => {
		disposed = true;
		if (frame !== null) cancelAnimationFrame(frame);
		unsubscribe();
		plotWindow.dispose();
		resizeObserver?.disconnect();
		chart?.dispose();
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
	state: AppState,
	series: PlotSeriesConfig[]
): ChartGPUOptions {
	const model = state.plotModel;
	const time = {
		measurementStartMs: state.trace?.metadata.measurementStartMs,
		mode: state.timestampMode
	};
	return {
		performance: { lod: 'strict' },
		theme: theme.config,
		grid: model.grid,
		gridLines: { color: theme.gridLine, opacity: 1 },
		xAxis: {
			type: 'time',
			min: state.activeViewport?.xMin,
			max: state.activeViewport?.xMax,
			tickFormatter: (value) => formatAxisTime(value, time)
		},
		axes: {
			y: model.axes.map((axis) => ({
				id: axis.id,
				type: 'value' as const,
				position: 'left' as const,
				min: state.axisRanges.get(axis.id)?.min,
				max: state.axisRanges.get(axis.id)?.max,
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
