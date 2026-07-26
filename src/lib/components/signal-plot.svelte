<script lang="ts">
	import { SIGNAL_COLORS } from '$lib/plot-colors.js';
	import { normalizedWheelDelta, type PlotRatioPoint } from '$lib/plot-geometry.js';
	import {
		capturePlotImage,
		copyPlotImage,
		plotImageFilename,
		savePlotImage
	} from '$lib/plot-image-export.js';
	import {
		panViewport,
		type PlotAxisRange,
		type PlotPoint,
		type PlotViewport
	} from '$lib/plot-viewport.js';
	import { plotGrid } from '$lib/plot-axis-layout.js';
	import { groupSignalsByYAxis, yAxisLabel, yAxisUnit, type YAxisId } from '$lib/plot-axes.js';
	import { plotAxes } from '$lib/stores/plot-axes.svelte.js';
	import { plotDragMode, plotWheelAction } from '$lib/plot-interaction-policy.js';
	import { shortcutKeys, type ShortcutPlatform } from '$lib/keyboard-shortcuts.js';
	import {
		crosshairById,
		removeCrosshair,
		setCrosshair,
		type CrosshairId,
		type LegendCrosshairMode,
		type PlotCrosshair
	} from '$lib/plot-crosshair.js';
	import {
		axisSplitDomain,
		createSignalViewCache,
		crosshairDeltaValue,
		crosshairValue,
		EMPTY_AXIS_RANGE,
		formatAxisTime,
		lineSeriesForViews,
		signalYRange
	} from '$lib/signal-plot-data.js';
	import { PlotWindow } from '$lib/plot-window.svelte.js';
	import { PlotViewportState } from '$lib/plot-viewport-state.svelte.js';
	import PlotInteraction from './plot-interaction.svelte';
	import PlotCrosshairOverlay from './plot-crosshair.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import SignalPlotAxes from './signal-plot-axes.svelte';
	import SignalPlotLegend from './signal-plot-legend.svelte';
	import ShortcutKey from './shortcut-key.svelte';
	import { createPlotPerfStats } from '$lib/plot-perf.js';
	import { isPlottableSignal, plotData } from '$lib/stores/plot-data.svelte.js';
	import { isDark, timestampMode } from '$lib/stores/preferences.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import { onDestroy, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { ChartGPUInstance, ChartGPUOptions } from 'chartgpu';
	import BoxSelectIcon from '@lucide/svelte/icons/box-select';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		dropActive = false,
		crosshairs = $bindable<PlotCrosshair[]>([]),
		legendCrosshairMode = $bindable<LegendCrosshairMode>('c1'),
		boxZoomEnabled = $bindable(false),
		legendVisible = $bindable(true),
		legendSelectOpen = $bindable(false),
		pointerRatio = $bindable<PlotRatioPoint | null>(null), // eslint-disable-line no-useless-assignment
		viewport,
		shortcutPlatform,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLElement> & {
		dropActive?: boolean;
		crosshairs?: PlotCrosshair[];
		legendCrosshairMode?: LegendCrosshairMode;
		boxZoomEnabled?: boolean;
		legendVisible?: boolean;
		legendSelectOpen?: boolean;
		pointerRatio?: PlotRatioPoint | null;
		viewport: PlotViewportState;
		shortcutPlatform: ShortcutPlatform;
	} = $props();
	let plotRoot: HTMLElement;
	let container: HTMLDivElement;
	let chart: ChartGPUInstance | null = null;
	let chartError = $state<string | null>(null);
	let contextMenuPoint = $state<PlotPoint | null>(null);
	let contextMenuCrosshairId = $state<CrosshairId | null>(null);
	let imageExportBusy = $state(false);
	let middleDrag = $state<{
		pointerId: number;
		clientX: number;
		clientY: number;
		startViewport: PlotViewport;
	} | null>(null);
	let resizeObserver: ResizeObserver | null = null;

	const WHEEL_ZOOM_SPEED = 0.002;
	const GRID_LINE = {
		dark: { color: '#f4f4f5', opacity: 0.1 },
		light: { color: '#71717a', opacity: 0.3 }
	} as const;
	const viewsForSignals = createSignalViewCache();
	const plottableSignals = $derived(plotData.signals.filter(isPlottableSignal));
	const hasPlottableSignals = $derived(plottableSignals.length > 0);
	const signalViews = $derived(viewsForSignals(plottableSignals));
	const measurementStartMs = $derived(traceFile.entry?.metadata.measurementStartMs);
	const traceDurationNs = $derived(traceFile.entry?.metadata.durationNs);

	const axisGroups = $derived(groupSignalsByYAxis(signalViews, plotAxes.ids, plotAxes.assignment));
	const axisViews = $derived(
		axisGroups.map((group) => {
			const unit = yAxisUnit(group.signals);
			return { ...group, unit, label: yAxisLabel(group.index, unit) };
		})
	);
	const primaryAxisId = $derived(axisViews[0].id);
	const axisIdByKey = $derived(
		new Map(axisGroups.flatMap((group) => group.signals.map((view) => [view.key, group.id])))
	);
	// An axis with nothing on it has no range worth drawing, so it earns no
	// gutter and no plot width until a signal lands on it.
	const gutterAxes = $derived(axisViews.filter((axis) => axis.signals.length > 0));
	const grid = $derived(plotGrid(gutterAxes.length));
	const secondaryFitRanges = $derived.by(() => {
		// Rebuilt on every evaluation, never mutated after: a derived lookup, not state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ranges = new Map<YAxisId, PlotAxisRange>();
		for (const group of axisGroups.slice(1)) {
			ranges.set(group.id, signalYRange(group.signals) ?? EMPTY_AXIS_RANGE);
		}
		return ranges;
	});

	let lastDomainValue: PlotViewport | null = null;
	const fullDomain = $derived.by(() => {
		const next =
			axisSplitDomain(signalViews, axisGroups[0].signals) ?? traceDurationDomain(traceDurationNs);
		// Keep the object identity stable while the values are unchanged so
		// derived consumers are not invalidated by view-list churn.
		if (
			next === null ||
			lastDomainValue === null ||
			next.xMin !== lastDomainValue.xMin ||
			next.xMax !== lastDomainValue.xMax ||
			next.yMin !== lastDomainValue.yMin ||
			next.yMax !== lastDomainValue.yMax
		) {
			lastDomainValue = next;
		}
		return lastDomainValue;
	});
	const plotReady = $derived(fullDomain !== null);
	const emptyMessage = 'Select signals from the signal selector to view them.';
	const activeViewport = $derived(viewport.activeViewport);
	const plotWindow = new PlotWindow();
	const windowedViews = $derived(plotWindow.viewsFor(signalViews, activeViewport));
	const chartSeries = $derived(
		lineSeriesForViews(windowedViews, (view) => axisIdByKey.get(view.key) ?? primaryAxisId)
	);
	// Visible bounds of every axis: the primary one is the viewport itself, the
	// rest follow the same proportional y window over their own fit range.
	const axisRanges = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived lookup
		const ranges = new Map<YAxisId, PlotAxisRange>(viewport.secondaryRanges);
		if (activeViewport !== null) {
			ranges.set(primaryAxisId, { min: activeViewport.yMin, max: activeViewport.yMax });
		}
		return ranges;
	});
	const c1 = $derived(crosshairById(crosshairs, 1));
	const c2 = $derived(crosshairById(crosshairs, 2));

	$effect(() => {
		plotWindow.settleAfter(signalViews, activeViewport);
	});
	const isFitAll = $derived(viewport.isFitAll);
	const legendSignalValues = $derived.by(() => {
		if (legendCrosshairMode === 'delta' && c1 !== null && c2 !== null) {
			return signalViews.map((view) => crosshairDeltaValue(view, c1.x, c2.x));
		}
		const crosshair = legendCrosshairMode === 'c2' ? c2 : c1;
		return crosshair === null ? [] : signalViews.map((view) => crosshairValue(view, crosshair.x));
	});
	onMount(() => {
		viewport.domainSource = () => fullDomain;
		viewport.secondaryRangeSource = () => secondaryFitRanges;
	});

	onMount(async () => {
		if (!('gpu' in navigator)) {
			return;
		}

		try {
			const mod = await import('chartgpu');
			const createChart = mod.ChartGPU.create;
			chart = await createChart(container, chartOptions());

			resizeObserver = new ResizeObserver(() => chart?.resize());
			resizeObserver.observe(container);
		} catch (error) {
			chartError = error instanceof Error ? error.message : 'ChartGPU failed to start.';
		}
	});

	onDestroy(() => {
		if (pushFrame !== null) cancelAnimationFrame(pushFrame);
		viewport.domainSource = null;
		viewport.secondaryRangeSource = null;
		plotWindow.dispose();
		resizeObserver?.disconnect();
		chart?.dispose();
	});

	$effect(() => {
		if (!hasPlottableSignals) {
			crosshairs = [];
			boxZoomEnabled = false;
			contextMenuPoint = null;
			contextMenuCrosshairId = null;
			viewport.reset();
		}
	});

	$effect(() => {
		if (legendCrosshairMode === 'delta' && (c1 === null || c2 === null)) {
			legendCrosshairMode = c1 !== null ? 'c1' : c2 !== null ? 'c2' : 'c1';
		} else if (legendCrosshairMode === 'c1' && c1 === null && c2 !== null) {
			legendCrosshairMode = 'c2';
		} else if (legendCrosshairMode === 'c2' && c2 === null && c1 !== null) {
			legendCrosshairMode = 'c1';
		}
	});

	$effect(() => {
		if (!legendVisible) legendSelectOpen = false;
	});

	const perfStats = createPlotPerfStats();
	let pendingOptions: ChartGPUOptions | null = null;
	let pushFrame: number | null = null;

	// Coalesce option pushes to one setOption per animation frame: pointer and
	// wheel events can fire faster than the display refreshes.
	$effect(() => {
		pendingOptions = chartOptions();
		pushFrame ??= requestAnimationFrame(() => {
			pushFrame = null;
			if (!chart || pendingOptions === null) return;
			const start = performance.now();
			chart.setOption(pendingOptions);
			perfStats?.record(performance.now() - start);
			pendingOptions = null;
		});
	});

	function toggleBoxZoom() {
		if (!hasPlottableSignals) return;
		boxZoomEnabled = !boxZoomEnabled;
	}

	function updateCrosshair(crosshair: PlotCrosshair): void {
		if (!hasPlottableSignals) return;
		crosshairs = setCrosshair(crosshairs, crosshair);
	}

	function placeCrosshairAtContextPoint(id: CrosshairId): void {
		if (contextMenuPoint === null) return;
		updateCrosshair({ id, ...contextMenuPoint });
	}

	function deleteCrosshair(id: CrosshairId): void {
		crosshairs = removeCrosshair(crosshairs, id);
	}

	function chartOptions(): ChartGPUOptions {
		const dark = isDark();
		const gridLine = dark ? GRID_LINE.dark : GRID_LINE.light;
		const axisMeasurementStartMs = measurementStartMs;
		const axisTimestampMode = timestampMode.current;

		return {
			theme: {
				backgroundColor: dark ? '#09090b' : '#ffffff',
				textColor: dark ? '#e4e4e7' : '#18181b',
				axisLineColor: dark ? '#3f3f46' : '#d4d4d8',
				axisTickColor: '#71717a',
				gridLineColor: gridLine.color,
				colorPalette: SIGNAL_COLORS,
				fontFamily: 'Geist Variable, sans-serif',
				fontSize: 12
			},
			grid,
			gridLines: {
				color: gridLine.color,
				opacity: gridLine.opacity
			},
			xAxis: {
				type: 'time',
				min: activeViewport?.xMin,
				max: activeViewport?.xMax,
				tickFormatter: (value) =>
					formatAxisTime(value, {
						measurementStartMs: axisMeasurementStartMs,
						mode: axisTimestampMode
					})
			},
			// ChartGPU scales each series against its own axis, but anchors every
			// left axis at the same edge and never draws the y axis line, so its
			// labels are suppressed and SignalPlotAxes renders the gutters instead.
			// Index 0 is the primary axis, which also drives the horizontal grid.
			axes: {
				y: axisViews.map((axis) => ({
					id: axis.id,
					type: 'value' as const,
					position: 'left' as const,
					min: axisRanges.get(axis.id)?.min,
					max: axisRanges.get(axis.id)?.max,
					tickFormatter: () => null
				}))
			},
			legend: { show: false },
			tooltip: { show: false },
			animation: false,
			palette: SIGNAL_COLORS,
			annotations: [],
			series: chartSeries
		};
	}

	function traceDurationDomain(durationNs: number | null | undefined): PlotViewport | null {
		if (durationNs === null || durationNs === undefined || !Number.isFinite(durationNs))
			return null;
		const durationMs = durationNs / 1_000_000;
		if (!(durationMs > 0)) return null;

		return {
			xMin: 0,
			xMax: durationMs,
			yMin: 0,
			yMax: 1
		};
	}

	function zoomBy(factor: number) {
		viewport.zoomBy(factor);
	}

	function resetZoom() {
		viewport.reset();
	}

	function rememberContextMenuPoint(point: PlotPoint | null, crosshair?: PlotCrosshair) {
		contextMenuPoint = point;
		contextMenuCrosshairId = crosshair?.id ?? null;
	}

	async function exportCurrentView(destination: 'copy' | 'save'): Promise<void> {
		if (imageExportBusy) return;
		imageExportBusy = true;

		try {
			const image = capturePlotImage(plotRoot);
			if (destination === 'copy') {
				await copyPlotImage(image);
				toast.success('Image copied to clipboard.');
			} else {
				await savePlotImage(image, plotImageFilename(traceFile.displayName));
			}
		} catch (error) {
			console.error('Plot image export failed.', error);
			toast.error(destination === 'copy' ? 'Could not copy image.' : 'Could not save image.');
		} finally {
			imageExportBusy = false;
		}
	}

	function handlePlotWheel(event: WheelEvent) {
		if (activeViewport === null || !isPlotInteractionTarget(event.target)) return;
		const point = currentPlotRatio(event);
		if (point === null) return;

		const plotSize = currentPlotSize();
		const delta = normalizedWheelDelta(event, plotSize.height);
		const action = plotWheelAction(delta, { shift: event.shiftKey, alt: event.altKey });
		if (action === null) return;

		event.preventDefault();
		if (action.type === 'pan-x') {
			viewport.panBy({ x: action.deltaX, y: 0 }, plotSize);
			return;
		}

		const factor = Math.exp(Math.min(200, Math.max(-200, action.delta)) * WHEEL_ZOOM_SPEED);
		viewport.zoomBy(factor, point, action.axes);
	}

	function startMiddleDrag(event: PointerEvent): void {
		if (
			event.button !== 1 ||
			plotDragMode(event.button, boxZoomEnabled) !== 'pan' ||
			activeViewport === null ||
			!isPlotInteractionTarget(event.target)
		) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		middleDrag = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			startViewport: activeViewport
		};
	}

	function dragMiddle(event: PointerEvent): void {
		if (middleDrag === null || middleDrag.pointerId !== event.pointerId) return;
		event.preventDefault();
		viewport.setManual(
			panViewport(
				middleDrag.startViewport,
				{
					x: event.clientX - middleDrag.clientX,
					y: event.clientY - middleDrag.clientY
				},
				currentPlotSize()
			)
		);
	}

	function stopMiddleDrag(event: PointerEvent): void {
		if (middleDrag === null || middleDrag.pointerId !== event.pointerId) return;
		middleDrag = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function preventMiddleAutoscroll(event: MouseEvent): void {
		if (event.button === 1 && isPlotInteractionTarget(event.target)) event.preventDefault();
	}

	function trackPlotPointer(event: PointerEvent): void {
		pointerRatio = isPlotInteractionTarget(event.target) ? currentPlotRatio(event) : null;
	}

	function isPlotInteractionTarget(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			(container.contains(target) || target.closest('[data-plot-wheel-target]') !== null)
		);
	}

	function currentPlotRatio(event: Pick<WheelEvent, 'clientX' | 'clientY'>): PlotRatioPoint | null {
		const rect = container.getBoundingClientRect();
		const size = currentPlotSize();
		if (!(size.width > 0) || !(size.height > 0)) return null;

		const x = event.clientX - rect.left - grid.left;
		const y = event.clientY - rect.top - grid.top;

		return {
			xRatio: Math.min(1, Math.max(0, x / size.width)),
			yRatio: Math.min(1, Math.max(0, y / size.height))
		};
	}

	function currentPlotSize(): { width: number; height: number } {
		const rect = container.getBoundingClientRect();
		return {
			width: rect.width - grid.left - grid.right,
			height: rect.height - grid.top - grid.bottom
		};
	}
</script>

<section
	bind:this={plotRoot}
	class={[
		'relative min-h-0 flex-1 overflow-hidden bg-background',
		dropActive ? 'outline-2 -outline-offset-2 outline-emerald-500/70' : '',
		className
	]}
	{...restProps}
	onwheel={handlePlotWheel}
	onpointerdowncapture={startMiddleDrag}
	onpointermovecapture={trackPlotPointer}
	onpointermove={dragMiddle}
	onpointerup={stopMiddleDrag}
	onpointercancel={stopMiddleDrag}
	onauxclick={preventMiddleAutoscroll}
	onpointerleave={() => (pointerRatio = null)}
>
	{#if dropActive}
		<div
			data-export-ignore
			class="pointer-events-none absolute inset-0 z-60 flex items-center justify-center bg-background/25 text-sm font-medium text-foreground backdrop-blur-[1px]"
		>
			Drop trace to open
		</div>
	{/if}
	<div bind:this={container} class="absolute inset-0" aria-label="Selected signal plot"></div>

	{#if hasPlottableSignals}
		<ContextMenu.Root>
			<ContextMenu.Trigger class="contents" disabled={!hasPlottableSignals}>
				<PlotInteraction
					{viewport}
					{boxZoomEnabled}
					suspended={legendSelectOpen}
					{grid}
					onContextMenuPoint={rememberContextMenuPoint}
				/>

				{#each crosshairs as crosshair (crosshair.id)}
					<PlotCrosshairOverlay
						{crosshair}
						viewport={activeViewport}
						suspended={legendSelectOpen}
						{grid}
						onCrosshair={updateCrosshair}
						onContextMenuPoint={rememberContextMenuPoint}
					/>
				{/each}
			</ContextMenu.Trigger>
			<ContextMenu.Content class="w-52">
				<ContextMenu.Item onSelect={() => zoomBy(0.5)}>
					<PlusIcon />
					Zoom in
					<ContextMenu.Shortcut>
						<ShortcutKey keys={shortcutKeys('zoomIn', shortcutPlatform)} />
					</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onSelect={() => zoomBy(2)}>
					<MinusIcon />
					Zoom out
					<ContextMenu.Shortcut>
						<ShortcutKey keys={shortcutKeys('zoomOut', shortcutPlatform)} />
					</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item disabled={isFitAll} onSelect={resetZoom}>
					<ExpandIcon />
					Zoom to full extent
					<ContextMenu.Shortcut>
						<ShortcutKey keys={shortcutKeys('resetZoom', shortcutPlatform)} />
					</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Sub>
					<ContextMenu.SubTrigger>
						<CrosshairIcon />
						Crosshairs
					</ContextMenu.SubTrigger>
					<ContextMenu.SubContent class="w-44">
						<ContextMenu.Item
							disabled={contextMenuPoint === null}
							onSelect={() => placeCrosshairAtContextPoint(1)}
						>
							<CrosshairIcon />
							Place C1
							<ContextMenu.Shortcut>
								<ShortcutKey keys={shortcutKeys('placeC1', shortcutPlatform)} />
							</ContextMenu.Shortcut>
						</ContextMenu.Item>
						<ContextMenu.Item
							disabled={contextMenuPoint === null}
							onSelect={() => placeCrosshairAtContextPoint(2)}
						>
							<CrosshairIcon />
							Place C2
							<ContextMenu.Shortcut>
								<ShortcutKey keys={shortcutKeys('placeC2', shortcutPlatform)} />
							</ContextMenu.Shortcut>
						</ContextMenu.Item>
						<ContextMenu.Item disabled={crosshairs.length === 0} onSelect={() => (crosshairs = [])}>
							<XIcon />
							Clear all
							<ContextMenu.Shortcut>
								<ShortcutKey keys={shortcutKeys('clearCrosshairs', shortcutPlatform)} />
							</ContextMenu.Shortcut>
						</ContextMenu.Item>
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
				{#if contextMenuCrosshairId !== null}
					<ContextMenu.Item onSelect={() => deleteCrosshair(contextMenuCrosshairId!)}>
						<XIcon />
						Remove C{contextMenuCrosshairId}
					</ContextMenu.Item>
				{/if}
				<ContextMenu.Item onSelect={toggleBoxZoom}>
					<BoxSelectIcon />
					{boxZoomEnabled ? 'Use drag pan' : 'Use box zoom'}
					<ContextMenu.Shortcut>
						<ShortcutKey keys={shortcutKeys('toggleBoxZoom', shortcutPlatform)} />
					</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					disabled={imageExportBusy}
					onSelect={() => void exportCurrentView('copy')}
				>
					<CopyIcon />
					Copy image
				</ContextMenu.Item>
				<ContextMenu.Item
					disabled={imageExportBusy}
					onSelect={() => void exportCurrentView('save')}
				>
					<DownloadIcon />
					Save image
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					disabled={plotData.selectedSignals.size === 0}
					variant="destructive"
					class="!text-destructive focus:!bg-destructive/10 focus:!text-destructive data-highlighted:!text-destructive dark:focus:!bg-destructive/20 [&_svg]:!text-destructive"
					onSelect={() => plotData.clearSelectedSignals()}
				>
					<RotateCcwIcon />
					Clear selected signals
				</ContextMenu.Item>
			</ContextMenu.Content>
		</ContextMenu.Root>
	{/if}

	{#if legendSelectOpen && hasPlottableSignals && legendVisible}
		<div
			data-export-ignore
			data-plot-interaction-blocker
			class="absolute inset-0 z-[45]"
			aria-hidden="true"
		></div>
	{/if}

	{#if hasPlottableSignals && plotReady}
		<SignalPlotAxes axes={gutterAxes} {grid} numbered={axisViews.length > 1} ranges={axisRanges} />
	{/if}

	{#if hasPlottableSignals && legendVisible}
		<SignalPlotLegend
			axes={axisViews}
			{axisRanges}
			canAddAxis={plotAxes.canAddAxis}
			{crosshairs}
			bind:mode={legendCrosshairMode}
			bind:selectOpen={legendSelectOpen}
			signalValues={legendSignalValues}
			{measurementStartMs}
			timestampMode={timestampMode.current}
			onAddAxis={() => plotAxes.addAxis()}
			onMove={(signalKey, axisId) => plotAxes.assign(signalKey, axisId)}
			onMoveToNewAxis={(signalKey) => plotAxes.assignToNewAxis(signalKey)}
			onRemoveAxis={(axisId) => plotAxes.removeAxis(axisId)}
		/>
	{/if}

	{#if !plotReady || !hasPlottableSignals}
		<div
			class={[
				'absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground',
				plotReady ? 'pointer-events-none z-30' : ''
			]}
		>
			{#if !plotReady && chartError}
				{chartError}
			{:else}
				{emptyMessage}
			{/if}
		</div>
	{/if}
</section>
