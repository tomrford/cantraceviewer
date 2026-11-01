import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useStore } from 'zustand';
import { toast } from 'sonner';
import type { ChartGPUInstance, ChartGPUOptions, ThemeConfig } from 'chartgpu';
import {
	BoxSelect,
	Copy,
	Crosshair,
	Download,
	Expand,
	Minus,
	Plus,
	RotateCcw,
	X
} from 'lucide-react';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger
} from '#lib/components/ui/context-menu.js';
import type { ShortcutAction } from '#lib/keyboard-shortcuts.js';
import { Y_TICK_COUNT, type AxisTickGenerator } from '#lib/plot-axis-layout.js';
import { SIGNAL_COLORS } from '#lib/plot-colors.js';
import type { CrosshairId } from '#lib/plot-crosshair.js';
import {
	capturePlotImage,
	copyPlotImage,
	plotImageFilename,
	savePlotImage
} from '#lib/plot-image-export.js';
import { createPlotPerfStats } from '#lib/plot-perf.js';
import { emptyAxisSeries, plotSeriesForViews, type PlotSeriesConfig } from '#lib/plot-series.js';
import { resolvePlotTheme, type PlotTheme } from '#lib/plot-theme.js';
import type { PlotPoint } from '#lib/plot-viewport.js';
import { PlotWindow } from '#lib/plot-window.js';
import { formatAxisTime, type WindowedSignalView } from '#lib/signal-plot-data.js';
import { clearSelectedSignals, plotData } from '#lib/stores/plot-data.js';
import { plotModel, type PlotModelState } from '#lib/stores/plot-model.js';
import {
	clearCrosshairs,
	deleteCrosshair,
	plotView,
	resetZoom,
	toggleBoxZoom,
	upsertCrosshair,
	zoomBy,
	type PlotViewState
} from '#lib/stores/plot-view.js';
import { preferences, type TimestampMode } from '#lib/stores/preferences.js';
import { traceFile } from '#lib/stores/trace-file.js';
import { cn } from '#lib/utils.js';
import { PlotCrosshairOverlay } from './plot-crosshair.js';
import { PlotInteraction } from './plot-interaction.js';
import { ShortcutKey } from './shortcut-key.js';
import { SignalPlotAxes } from './signal-plot-axes.js';
import { SignalPlotLegend } from './signal-plot-legend.js';

const AXIS_FONT_SIZE = 12;
const EMPTY_MESSAGE = 'Select signals from the signal selector to view them.';

type ContextTarget = { point: PlotPoint | null; crosshairId: CrosshairId | null };
type ImageDestination = 'copy' | 'save';
type RendererState =
	| { status: 'loading' | 'unsupported' }
	| { status: 'ready'; generateTicks: AxisTickGenerator }
	| { status: 'error'; message: string };

/**
 * The ChartGPU plot with its overlays. Chart options are pushed from store subscriptions on one
 * animation frame, outside React rendering; React renders only discrete plot state.
 */
export function SignalPlot({
	dropActive = false,
	className,
	...props
}: ComponentProps<'section'> & { dropActive?: boolean }) {
	const rootRef = useRef<HTMLElement>(null);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const [renderer, setRenderer] = useState<RendererState>({ status: 'loading' });
	const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
	const [imageExportBusy, setImageExportBusy] = useState(false);

	const hasPlottableSignals = useStore(plotData, (state) => state.hasPlottableSignals);
	const hasSelectedSignals = useStore(plotData, (state) => state.selected.size > 0);
	const dataReady = useStore(plotModel, (state) => state.fullDomain !== null);
	const isFitAll = useStore(plotView, (state) => state.isFitAll);
	const hasCrosshairs = useStore(plotView, (state) => state.crosshairs.length > 0);
	const boxZoomEnabled = useStore(plotView, (state) => state.boxZoomEnabled);
	const legendVisible = useStore(plotView, (state) => state.legendVisible);
	const legendSelectOpen = useStore(plotView, (state) => state.legendSelectOpen);
	// A remembered point is meaningless once nothing is plotted.
	const contextMenu = hasPlottableSignals ? contextTarget : null;
	const removableCrosshair = contextMenu?.crosshairId ?? null;
	const hasData = hasPlottableSignals && dataReady;
	const rendererMessage =
		renderer.status === 'loading'
			? hasData
				? 'Starting plot renderer…'
				: null
			: renderer.status === 'unsupported'
				? 'WebGPU is unavailable. Use a browser with WebGPU enabled to view the plot.'
				: renderer.status === 'error'
					? `Could not start the plot renderer: ${renderer.message}`
					: null;

	useEffect(() => {
		const root = rootRef.current;
		const surface = surfaceRef.current;
		if (root === null || surface === null) return;
		return mountChart(root, surface, setRenderer);
	}, []);

	function rememberContextMenuPoint(
		point: PlotPoint | null,
		crosshairId: CrosshairId | null = null
	) {
		setContextTarget({ point, crosshairId });
	}

	function placeCrosshairAtContextPoint(id: CrosshairId) {
		if (contextMenu?.point) upsertCrosshair({ id, ...contextMenu.point });
	}

	async function exportCurrentView(destination: ImageDestination) {
		const root = rootRef.current;
		if (imageExportBusy || root === null) return;
		setImageExportBusy(true);
		await exportPlotImage(root, destination);
		setImageExportBusy(false);
	}

	const shortcut = (action: ShortcutAction) => (
		<ContextMenuShortcut>
			<ShortcutKey action={action} />
		</ContextMenuShortcut>
	);

	return (
		<section
			ref={rootRef}
			className={cn(
				'relative min-h-0 flex-1 overflow-hidden bg-background',
				dropActive && 'outline-2 -outline-offset-2 outline-emerald-500/70',
				className
			)}
			{...props}
		>
			{dropActive && (
				<div
					data-export-ignore
					className="pointer-events-none absolute inset-0 z-60 flex items-center justify-center bg-background/25 text-sm font-medium text-foreground backdrop-blur-[1px]"
				>
					Drop trace to open
				</div>
			)}
			<div ref={surfaceRef} className="absolute inset-0" aria-label="Selected signal plot" />

			{hasPlottableSignals && (
				<ContextMenu>
					<ContextMenuTrigger className="contents">
						<PlotInteraction
							eventRoot={rootRef}
							plotSurface={surfaceRef}
							onContextMenuPoint={rememberContextMenuPoint}
						/>
						<PlotCrosshairOverlay id={1} onContextMenuPoint={rememberContextMenuPoint} />
						<PlotCrosshairOverlay id={2} onContextMenuPoint={rememberContextMenuPoint} />
					</ContextMenuTrigger>
					<ContextMenuContent className="w-52">
						<ContextMenuItem onClick={() => zoomBy(0.5)}>
							<Plus />
							Zoom in
							{shortcut('zoomIn')}
						</ContextMenuItem>
						<ContextMenuItem onClick={() => zoomBy(2)}>
							<Minus />
							Zoom out
							{shortcut('zoomOut')}
						</ContextMenuItem>
						<ContextMenuItem disabled={isFitAll} onClick={resetZoom}>
							<Expand />
							Zoom to full extent
							{shortcut('resetZoom')}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuSub>
							<ContextMenuSubTrigger>
								<Crosshair />
								Crosshairs
							</ContextMenuSubTrigger>
							<ContextMenuSubContent className="w-44">
								{([1, 2] as const).map((id) => (
									<ContextMenuItem
										key={id}
										disabled={!contextMenu?.point}
										onClick={() => placeCrosshairAtContextPoint(id)}
									>
										<Crosshair />
										Place C{id}
										{shortcut(id === 1 ? 'placeC1' : 'placeC2')}
									</ContextMenuItem>
								))}
								<ContextMenuItem disabled={!hasCrosshairs} onClick={clearCrosshairs}>
									<X />
									Clear all
									{shortcut('clearCrosshairs')}
								</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuSub>
						{removableCrosshair !== null && (
							<ContextMenuItem onClick={() => deleteCrosshair(removableCrosshair)}>
								<X />
								Remove C{removableCrosshair}
							</ContextMenuItem>
						)}
						<ContextMenuItem onClick={toggleBoxZoom}>
							<BoxSelect />
							{boxZoomEnabled ? 'Use drag pan' : 'Use box zoom'}
							{shortcut('toggleBoxZoom')}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={imageExportBusy}
							onClick={() => void exportCurrentView('copy')}
						>
							<Copy />
							Copy image
						</ContextMenuItem>
						<ContextMenuItem
							disabled={imageExportBusy}
							onClick={() => void exportCurrentView('save')}
						>
							<Download />
							Save image
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={!hasSelectedSignals}
							variant="destructive"
							className="text-destructive! focus:bg-destructive/10! focus:text-destructive! data-highlighted:text-destructive! dark:focus:bg-destructive/20! [&_svg]:text-destructive!"
							onClick={clearSelectedSignals}
						>
							<RotateCcw />
							Clear selected signals
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			)}

			{legendSelectOpen && hasPlottableSignals && legendVisible && (
				<div
					data-export-ignore
					data-plot-interaction-blocker
					className="absolute inset-0 z-[45]"
					aria-hidden="true"
				/>
			)}

			{hasData && renderer.status === 'ready' && (
				<SignalPlotAxes generateTicks={renderer.generateTicks} />
			)}

			{hasPlottableSignals && legendVisible && <SignalPlotLegend />}

			{(rendererMessage !== null || !hasData) && (
				<div
					role={renderer.status === 'error' ? 'alert' : 'status'}
					className="absolute inset-0 z-30 flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
				>
					{rendererMessage ?? EMPTY_MESSAGE}
				</div>
			)}
		</section>
	);
}

/**
 * Starts ChartGPU on `surface` (when WebGPU exists) and pushes options from store subscriptions,
 * coalesced to one `setOption` per animation frame. Returns the teardown.
 */
function mountChart(
	root: HTMLElement,
	surface: HTMLElement,
	onStatus: (state: RendererState) => void
): () => void {
	let disposed = false;
	let chart: ChartGPUInstance | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let frame: number | null = null;
	let theme = chartTheme(resolvePlotTheme(getComputedStyle(root)));
	// ChartGPU reuses per-series state only for identical series objects, so rebuild them only
	// when the windowed views or the axis assignment change.
	let seriesCache: {
		views: WindowedSignalView[];
		model: PlotModelState;
		series: PlotSeriesConfig[];
	} | null = null;
	const perfStats = createPlotPerfStats();
	const plotWindow = new PlotWindow(schedule);

	function currentOptions(): ChartGPUOptions {
		const model = plotModel.getState();
		const view = plotView.getState();
		const views = plotWindow.viewsFor(model.views, view.activeViewport);
		if (seriesCache?.views !== views || seriesCache.model !== model) {
			const series = plotSeriesForViews(
				views,
				(signal) => model.axisIdByKey.get(signal.key) ?? model.primaryAxisId
			);
			seriesCache = {
				views,
				model,
				series: series.length > 0 ? series : [emptyAxisSeries(model.primaryAxisId)]
			};
		}
		return chartOptions(theme, model, view, seriesCache.series, {
			measurementStartMs: traceFile.getState().entry?.metadata.measurementStartMs,
			mode: preferences.getState().timestampMode
		});
	}

	function schedule() {
		if (frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			if (chart === null) return;
			const start = performance.now();
			chart.setOption(currentOptions());
			perfStats?.record(performance.now() - start);
			plotWindow.settleAfter(plotModel.getState().views, plotView.getState().activeViewport);
		});
	}

	async function start() {
		try {
			const mod = await import('chartgpu');
			if (disposed) return;
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
					message: error instanceof Error ? error.message : 'ChartGPU failed to start.'
				});
			}
		}
	}

	const themeObserver = new MutationObserver(() => {
		theme = chartTheme(resolvePlotTheme(getComputedStyle(root)));
		schedule();
	});
	themeObserver.observe(document.documentElement, { attributeFilter: ['class'] });
	// Every viewport write replaces `axisRanges`, so it alone tracks viewport changes.
	const unsubscribes = [
		plotModel.subscribe(schedule),
		plotView.subscribe((state) => state.axisRanges, schedule),
		preferences.subscribe(schedule)
	];
	if (navigator.gpu) void start();
	else onStatus({ status: 'unsupported' });

	return () => {
		disposed = true;
		if (frame !== null) cancelAnimationFrame(frame);
		for (const unsubscribe of unsubscribes) unsubscribe();
		themeObserver.disconnect();
		plotWindow.dispose();
		resizeObserver?.disconnect();
		chart?.dispose();
	};
}

async function exportPlotImage(root: HTMLElement, destination: ImageDestination): Promise<void> {
	try {
		const image = capturePlotImage(root);
		if (destination === 'copy') {
			await copyPlotImage(image);
			toast.success('Image copied to clipboard.');
		} else {
			await savePlotImage(image, plotImageFilename(traceFile.getState().displayName));
		}
	} catch (error) {
		console.error('Plot image export failed.', error);
		toast.error(destination === 'copy' ? 'Could not copy image.' : 'Could not save image.');
	}
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
	model: PlotModelState,
	view: PlotViewState,
	series: PlotSeriesConfig[],
	time: { measurementStartMs?: number | null; mode: TimestampMode }
): ChartGPUOptions {
	return {
		performance: { lod: 'strict' },
		theme: theme.config,
		grid: model.grid,
		gridLines: { color: theme.gridLine, opacity: 1 },
		xAxis: {
			type: 'time',
			min: view.activeViewport?.xMin,
			max: view.activeViewport?.xMax,
			tickFormatter: (value) => formatAxisTime(value, time)
		},
		axes: {
			y: model.axes.map((axis) => ({
				id: axis.id,
				type: 'value' as const,
				position: 'left' as const,
				min: view.axisRanges.get(axis.id)?.min,
				max: view.axisRanges.get(axis.id)?.max,
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
