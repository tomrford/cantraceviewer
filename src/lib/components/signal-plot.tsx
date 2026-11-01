import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useStore } from 'zustand';
import { toast } from 'sonner';
import type { ChartGPUInstance, ChartGPUOptions } from 'chartgpu';
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
import {
	shortcutKeys,
	type ShortcutAction,
	type ShortcutPlatform
} from '#lib/keyboard-shortcuts.js';
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
import { emptyAxisSeries, plotSeriesForViews } from '#lib/plot-series.js';
import { resolvePlotTheme, type PlotTheme } from '#lib/plot-theme.js';
import type { PlotPoint } from '#lib/plot-viewport.js';
import { PlotWindow } from '#lib/plot-window.js';
import { formatAxisTime } from '#lib/signal-plot-data.js';
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

/**
 * The ChartGPU plot with its overlays. Chart options are pushed from store subscriptions on one
 * animation frame, outside React rendering; React renders only discrete plot state.
 */
export function SignalPlot({
	dropActive = false,
	shortcutPlatform,
	className,
	...props
}: ComponentProps<'section'> & { dropActive?: boolean; shortcutPlatform: ShortcutPlatform }) {
	const rootRef = useRef<HTMLElement>(null);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const [generateTicks, setGenerateTicks] = useState<AxisTickGenerator | null>(null);
	const [chartError, setChartError] = useState<string | null>(null);
	const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
	const [imageExportBusy, setImageExportBusy] = useState(false);

	const hasPlottableSignals = useStore(plotData, (state) => state.hasPlottableSignals);
	const hasSelectedSignals = useStore(plotData, (state) => state.selected.size > 0);
	const plotReady = useStore(plotModel, (state) => state.fullDomain !== null);
	const isFitAll = useStore(plotView, (state) => state.isFitAll);
	const hasCrosshairs = useStore(plotView, (state) => state.crosshairs.length > 0);
	const boxZoomEnabled = useStore(plotView, (state) => state.boxZoomEnabled);
	const legendVisible = useStore(plotView, (state) => state.legendVisible);
	const legendSelectOpen = useStore(plotView, (state) => state.legendSelectOpen);
	// A remembered point is meaningless once nothing is plotted.
	const contextMenu = hasPlottableSignals ? contextTarget : null;
	const removableCrosshair = contextMenu?.crosshairId ?? null;

	useEffect(() => {
		const root = rootRef.current;
		const surface = surfaceRef.current;
		if (root === null || surface === null) return;

		let disposed = false;
		let chart: ChartGPUInstance | null = null;
		let resizeObserver: ResizeObserver | null = null;
		let frame: number | null = null;
		let theme = resolvePlotTheme(getComputedStyle(root));
		const perfStats = createPlotPerfStats();
		const plotWindow = new PlotWindow(schedule);

		function currentOptions(): ChartGPUOptions {
			const model = plotModel.getState();
			const view = plotView.getState();
			const views = plotWindow.viewsFor(model.views, view.activeViewport);
			return chartOptions(theme, model, view, views, {
				measurementStartMs: traceFile.getState().entry?.metadata.measurementStartMs,
				mode: preferences.getState().timestampMode
			});
		}

		function settle() {
			plotWindow.settleAfter(plotModel.getState().views, plotView.getState().activeViewport);
		}

		function schedule() {
			frame ??= requestAnimationFrame(() => {
				frame = null;
				if (chart === null) return;
				const start = performance.now();
				chart.setOption(currentOptions());
				perfStats?.record(performance.now() - start);
				settle();
			});
		}

		const themeObserver = new MutationObserver(() => {
			theme = resolvePlotTheme(getComputedStyle(root));
			schedule();
		});
		themeObserver.observe(document.documentElement, { attributeFilter: ['class'] });
		const unsubscribes = [
			plotModel.subscribe(schedule),
			plotView.subscribe((state) => state.activeViewport, schedule),
			plotView.subscribe((state) => state.axisRanges, schedule),
			preferences.subscribe(schedule)
		];

		if ('gpu' in navigator) {
			void (async () => {
				try {
					const mod = await import('chartgpu');
					if (disposed) return;
					const created = await mod.ChartGPU.create(surface, currentOptions());
					if (disposed) {
						created.dispose();
						return;
					}
					chart = created;
					settle();
					setGenerateTicks(() => mod.generateValueAxisTicks);
					resizeObserver = new ResizeObserver(() => chart?.resize());
					resizeObserver.observe(surface);
				} catch (error) {
					if (!disposed) {
						setChartError(error instanceof Error ? error.message : 'ChartGPU failed to start.');
					}
				}
			})();
		}

		return () => {
			disposed = true;
			if (frame !== null) cancelAnimationFrame(frame);
			for (const unsubscribe of unsubscribes) unsubscribe();
			themeObserver.disconnect();
			plotWindow.dispose();
			resizeObserver?.disconnect();
			chart?.dispose();
		};
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

	async function exportCurrentView(destination: 'copy' | 'save') {
		const root = rootRef.current;
		if (imageExportBusy || root === null) return;
		setImageExportBusy(true);
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
		} finally {
			setImageExportBusy(false);
		}
	}

	const shortcut = (action: ShortcutAction) => (
		<ContextMenuShortcut>
			<ShortcutKey keys={shortcutKeys(action, shortcutPlatform)} />
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

			{hasPlottableSignals && plotReady && generateTicks !== null && (
				<SignalPlotAxes generateTicks={generateTicks} />
			)}

			{hasPlottableSignals && legendVisible && <SignalPlotLegend />}

			{(!plotReady || !hasPlottableSignals) && (
				<div
					className={cn(
						'absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground',
						plotReady && 'pointer-events-auto z-30'
					)}
				>
					{!plotReady && chartError ? chartError : EMPTY_MESSAGE}
				</div>
			)}
		</section>
	);
}

function chartOptions(
	theme: PlotTheme,
	model: PlotModelState,
	view: PlotViewState,
	views: ReturnType<PlotWindow['viewsFor']>,
	time: { measurementStartMs?: number | null; mode: TimestampMode }
): ChartGPUOptions {
	const series = plotSeriesForViews(
		views,
		(signal) => model.axisIdByKey.get(signal.key) ?? model.primaryAxisId
	);
	return {
		performance: { lod: 'strict' },
		theme: {
			backgroundColor: theme.background,
			textColor: theme.text,
			axisLineColor: theme.axisLine,
			axisTickColor: theme.axisTick,
			gridLineColor: theme.gridLine,
			colorPalette: SIGNAL_COLORS,
			fontFamily: theme.fontFamily,
			fontSize: AXIS_FONT_SIZE
		},
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
		series: series.length > 0 ? series : [emptyAxisSeries(model.primaryAxisId)]
	};
}
