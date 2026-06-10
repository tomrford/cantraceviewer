<script lang="ts">
	import {
		normalizedWheelDelta,
		type PlotRatioPoint,
		plotSize,
		pointerToPlotRatio
	} from '$lib/plot-geometry.js';
	import { SIGNAL_COLORS } from '$lib/plot-colors.js';
	import {
		boxViewport,
		panViewport,
		type PlotViewport,
		viewportsAlmostEqual,
		viewportCenterX,
		zoomViewport
	} from '$lib/plot-viewport.js';
	import {
		formatAxisValue,
		formatAxisTime,
		lineSeriesForViews,
		markerValue,
		signalDomain,
		signalView,
		visibleSignalViews
	} from '$lib/signal-plot-data.js';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import SignalPlotLegend from './signal-plot-legend.svelte';
	import { isPlottableSignal, plotData } from '$lib/stores/plot-data.svelte.js';
	import { isDark, timestampMode } from '$lib/stores/preferences.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { ChartGPUInstance, ChartGPUOptions } from 'chartgpu';
	import BoxSelectIcon from '@lucide/svelte/icons/box-select';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SeparatorVerticalIcon from '@lucide/svelte/icons/separator-vertical';

	let {
		dropActive = false,
		markerEnabled = $bindable(false),
		markerX = $bindable<number | null>(null),
		boxZoomEnabled = $bindable(false),
		legendVisible = $bindable(true),
		onCanResetZoomChange,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLElement> & {
		dropActive?: boolean;
		markerEnabled?: boolean;
		markerX?: number | null;
		boxZoomEnabled?: boolean;
		legendVisible?: boolean;
		onCanResetZoomChange?: (canReset: boolean) => void;
	} = $props();
	let container: HTMLDivElement;
	let chart: ChartGPUInstance | null = null;
	let createChart:
		| ((container: HTMLElement, options: ChartGPUOptions) => Promise<ChartGPUInstance>)
		| null = null;
	let chartError = $state<string | null>(null);
	let markerDragPointerId = $state<number | null>(null);
	let viewport = $state<PlotViewport | null>(null);
	let lastFullDomain: PlotViewport | null = null;
	let dragState = $state<DragState | null>(null);
	let contextMenuX = $state<number | null>(null);
	let lastSignature = '';
	let markerDragRaf: number | null = null;
	let pendingMarkerX: number | null = null;
	let resizeObserver: ResizeObserver | null = null;

	const PLOT_GRID = { left: 64, right: 24, top: 18, bottom: 44 };
	const GRID_LINE = {
		dark: { color: '#f4f4f5', opacity: 0.1 },
		light: { color: '#71717a', opacity: 0.3 }
	} as const;
	const WHEEL_ZOOM_SPEED = 0.002;

	type DragState =
		| {
				type: 'pan';
				pointerId: number;
				clientX: number;
				clientY: number;
				startViewport: PlotViewport;
		  }
		| {
				type: 'box';
				pointerId: number;
				start: PlotRatioPoint;
				current: PlotRatioPoint;
		  };

	const plottableSignals = $derived(plotData.signals.filter(isPlottableSignal));
	const hasPlottableSignals = $derived(plottableSignals.length > 0);
	const signalViews = $derived(plottableSignals.map((signal) => signalView(signal)));
	const measurementStartMs = $derived(traceFile.entry?.metadata.measurementStartMs);
	const traceDurationNs = $derived(traceFile.entry?.metadata.durationNs);
	const fullDomain = $derived.by(
		() => signalDomain(signalViews) ?? traceDurationDomain(traceDurationNs)
	);
	const plotReady = $derived(fullDomain !== null);
	const activeViewport = $derived(viewport ?? fullDomain);
	const visibleViews = $derived(visibleSignalViews(signalViews, activeViewport));
	const isFitAll = $derived(viewportsAlmostEqual(activeViewport, fullDomain));
	const displayedMarkerX = $derived.by(() => {
		if (!hasPlottableSignals || !markerEnabled || markerX === null) return null;
		return markerX;
	});
	const markerPercent = $derived.by(() => {
		if (displayedMarkerX === null || activeViewport === null) return null;
		const span = activeViewport.xMax - activeViewport.xMin;
		if (!(span > 0)) return null;
		const percent = ((displayedMarkerX - activeViewport.xMin) / span) * 100;
		if (percent < 0 || percent > 100) return null;
		return percent;
	});
	const markerValues = $derived.by(() => {
		const x = displayedMarkerX;
		if (x === null) {
			return signalViews.map((view) => ({
				key: view.key,
				text: view.latestText
			}));
		}

		return signalViews.map((view) => markerValue(view, x));
	});
	onMount(async () => {
		if (!('gpu' in navigator)) {
			return;
		}

		try {
			const mod = await import('chartgpu');
			createChart = mod.ChartGPU.create;
			chart = await createChart(container, chartOptions());

			resizeObserver = new ResizeObserver(() => chart?.resize());
			resizeObserver.observe(container);
		} catch (error) {
			chartError = error instanceof Error ? error.message : 'ChartGPU failed to start.';
		}
	});

	onDestroy(() => {
		cancelMarkerDragUpdate();
		resizeObserver?.disconnect();
		chart?.dispose();
	});

	let lastReportedCanReset: boolean | undefined;

	$effect(() => {
		const canReset = hasPlottableSignals && !isFitAll;
		if (lastReportedCanReset === canReset) return;
		lastReportedCanReset = canReset;
		onCanResetZoomChange?.(canReset);
	});

	$effect(() => {
		if (!hasPlottableSignals) {
			markerEnabled = false;
			markerX = null;
			boxZoomEnabled = false;
			dragState = null;
			contextMenuX = null;
			if (viewport !== null) viewport = null;
			return;
		}

		if (!markerEnabled) {
			markerX = null;
			return;
		}

		if (markerX === null && activeViewport !== null) {
			markerX = viewportCenterX(activeViewport);
		}
	});

	$effect(() => {
		const currentViewport = untrack(() => viewport);
		const wasFitAll =
			currentViewport === null || viewportsAlmostEqual(currentViewport, lastFullDomain);
		if (fullDomain === null) {
			if (currentViewport !== null) viewport = null;
			lastFullDomain = null;
			return;
		}

		if (wasFitAll && !viewportsAlmostEqual(currentViewport, fullDomain)) viewport = fullDomain;
		lastFullDomain = fullDomain;
	});

	$effect(() => {
		const signature = JSON.stringify({
			measurementStartMs,
			hasPlottableSignals,
			isDark: isDark(),
			timestampMode: timestampMode.current,
			viewport: activeViewport,
			visible: visibleViews.map((view) => [view.key, view.points])
		});

		if (signature === lastSignature) return;
		lastSignature = signature;
		chart?.setOption(chartOptions());
	});

	function whenPlotInteractive(action: () => void) {
		if (!hasPlottableSignals) return;
		action();
	}

	export function plotZoomIn() {
		whenPlotInteractive(() => {
			zoomBy(0.5);
		});
	}

	export function plotZoomOut() {
		whenPlotInteractive(() => {
			zoomBy(2);
		});
	}

	export function plotResetZoom() {
		whenPlotInteractive(() => {
			resetZoom();
		});
	}

	function toggleMarker() {
		if (!hasPlottableSignals) return;
		markerEnabled = !markerEnabled;
	}

	function toggleBoxZoom() {
		if (!hasPlottableSignals) return;
		boxZoomEnabled = !boxZoomEnabled;
	}

	function placeMarkerAt(x: number): void {
		if (!hasPlottableSignals) return;
		if (!markerEnabled) markerEnabled = true;
		markerX = x;
	}

	function cancelMarkerDragUpdate() {
		if (markerDragRaf !== null) {
			cancelAnimationFrame(markerDragRaf);
			markerDragRaf = null;
		}
		pendingMarkerX = null;
	}

	function flushPendingMarkerUpdate() {
		if (markerDragRaf !== null) {
			cancelAnimationFrame(markerDragRaf);
			markerDragRaf = null;
		}

		if (pendingMarkerX !== null) {
			placeMarkerAt(pendingMarkerX);
			pendingMarkerX = null;
		}
	}

	function chartOptions(): ChartGPUOptions {
		const dark = isDark();
		const gridLine = dark ? GRID_LINE.dark : GRID_LINE.light;

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
			grid: PLOT_GRID,
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
						measurementStartMs,
						mode: timestampMode.current
					})
			},
			yAxis: {
				type: 'value',
				min: activeViewport?.yMin,
				max: activeViewport?.yMax,
				tickFormatter: formatAxisValue
			},
			legend: { show: false },
			tooltip: { show: false },
			animation: false,
			palette: SIGNAL_COLORS,
			annotations: [],
			series: lineSeriesForViews(visibleViews)
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
		if (activeViewport === null) return;
		viewport = zoomViewport(activeViewport, factor, { xRatio: 0.5, yRatio: 0.5 });
	}

	function resetZoom() {
		if (fullDomain === null) return;
		viewport = fullDomain;
		dragState = null;
	}

	function startMarkerDrag(event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		markerDragPointerId = event.pointerId;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		updateMarkerFromPointer(event);
	}

	function dragMarker(event: PointerEvent) {
		if (markerDragPointerId !== event.pointerId) return;
		event.preventDefault();
		updateMarkerFromPointer(event);
	}

	function stopMarkerDrag(event: PointerEvent) {
		if (markerDragPointerId !== event.pointerId) return;
		markerDragPointerId = null;
		flushPendingMarkerUpdate();
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function updateMarkerFromPointer(event: PointerEvent) {
		const x = pointerToDataX(event);
		if (x === null) return;

		pendingMarkerX = x;
		if (markerDragRaf !== null) return;

		markerDragRaf = requestAnimationFrame(() => {
			markerDragRaf = null;
			if (pendingMarkerX === null) return;
			placeMarkerAt(pendingMarkerX);
			pendingMarkerX = null;
		});
	}

	function pointerToDataX(event: PointerEvent): number | null {
		return clientToDataX(event);
	}

	function clientToDataX(event: Pick<MouseEvent, 'clientX' | 'clientY'>): number | null {
		if (activeViewport === null) return null;
		const point = currentPlotRatio(event);
		if (point === null) return null;
		return activeViewport.xMin + point.xRatio * (activeViewport.xMax - activeViewport.xMin);
	}

	function rememberContextMenuPoint(event: MouseEvent) {
		contextMenuX = clientToDataX(event);
	}

	function handlePlotWheel(event: WheelEvent) {
		if (activeViewport === null) return;
		const point = currentPlotRatio(event);
		if (point === null) return;

		const delta = normalizedWheelDelta(event, currentPlotSize().height);
		if (delta.x === 0 && delta.y === 0) return;

		if (Math.abs(delta.x) > Math.abs(delta.y) && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			const plotSize = currentPlotSize();
			viewport = panViewport(activeViewport, { x: -delta.x, y: 0 }, plotSize);
			return;
		}

		event.preventDefault();
		const factor = Math.exp(Math.min(200, Math.max(-200, delta.y)) * WHEEL_ZOOM_SPEED);
		viewport = zoomViewport(activeViewport, factor, point, {
			x: !event.altKey,
			y: !event.shiftKey
		});
	}

	function startPlotDrag(event: PointerEvent) {
		if (activeViewport === null || event.button !== 0) return;
		const point = currentPlotRatio(event);
		if (point === null) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

		dragState = boxZoomEnabled
			? { type: 'box', pointerId: event.pointerId, start: point, current: point }
			: {
					type: 'pan',
					pointerId: event.pointerId,
					clientX: event.clientX,
					clientY: event.clientY,
					startViewport: activeViewport
				};
	}

	function dragPlot(event: PointerEvent) {
		if (dragState === null || dragState.pointerId !== event.pointerId) return;
		event.preventDefault();

		if (dragState.type === 'box') {
			const point = currentPlotRatio(event);
			if (point !== null) dragState = { ...dragState, current: point };
			return;
		}

		viewport = panViewport(
			dragState.startViewport,
			{
				x: event.clientX - dragState.clientX,
				y: event.clientY - dragState.clientY
			},
			currentPlotSize()
		);
	}

	function stopPlotDrag(event: PointerEvent) {
		if (dragState === null || dragState.pointerId !== event.pointerId) return;
		const state = dragState;
		dragState = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);

		if (state.type === 'box' && activeViewport !== null) {
			const nextViewport = boxViewport(activeViewport, state.start, state.current);
			if (nextViewport !== null) viewport = nextViewport;
		}
	}

	function cancelBoxZoom(event: KeyboardEvent) {
		if (event.key !== 'Escape' || dragState?.type !== 'box') return;
		event.preventDefault();
		dragState = null;
	}

	function currentPlotRatio(
		event: Pick<PointerEvent, 'clientX' | 'clientY'>
	): PlotRatioPoint | null {
		return pointerToPlotRatio(container.getBoundingClientRect(), PLOT_GRID, event);
	}

	function currentPlotSize(): { width: number; height: number } {
		return plotSize(container.getBoundingClientRect(), PLOT_GRID);
	}
</script>

<section
	class={[
		'relative min-h-0 flex-1 overflow-hidden bg-background',
		dropActive ? 'outline-2 -outline-offset-2 outline-emerald-500/70' : '',
		className
	]}
	{...restProps}
>
	{#if dropActive}
		<div
			class="pointer-events-none absolute inset-0 z-60 flex items-center justify-center bg-background/25 text-sm font-medium text-foreground backdrop-blur-[1px]"
		>
			Drop trace to open
		</div>
	{/if}
	<div bind:this={container} class="absolute inset-0" aria-label="Selected signal plot"></div>

	{#if hasPlottableSignals}
		<ContextMenu.Root>
			<ContextMenu.Trigger
				class="contents"
				disabled={!hasPlottableSignals}
				oncontextmenu={rememberContextMenuPoint}
			>
				<button
					type="button"
					class={`absolute z-30 border-0 bg-transparent p-0 text-left outline-none ${
						boxZoomEnabled
							? 'cursor-crosshair'
							: dragState?.type === 'pan'
								? 'cursor-grabbing'
								: 'cursor-grab'
					}`}
					style:top={`${PLOT_GRID.top}px`}
					style:bottom={`${PLOT_GRID.bottom}px`}
					style:left={`${PLOT_GRID.left}px`}
					style:right={`${PLOT_GRID.right}px`}
					aria-label="Plot viewport interaction"
					onwheel={handlePlotWheel}
					onpointerdown={startPlotDrag}
					onpointermove={dragPlot}
					onpointerup={stopPlotDrag}
					onpointercancel={stopPlotDrag}
					onkeydown={cancelBoxZoom}
				>
					{#if dragState?.type === 'box'}
						<div
							class="absolute border border-current bg-current/10 text-foreground"
							style:left={`${Math.min(dragState.start.xRatio, dragState.current.xRatio) * 100}%`}
							style:top={`${Math.min(dragState.start.yRatio, dragState.current.yRatio) * 100}%`}
							style:width={`${Math.abs(dragState.current.xRatio - dragState.start.xRatio) * 100}%`}
							style:height={`${Math.abs(dragState.current.yRatio - dragState.start.yRatio) * 100}%`}
						></div>
					{/if}
				</button>

				{#if markerPercent !== null}
					<div
						class="pointer-events-none absolute z-40 text-foreground"
						style:top={`${PLOT_GRID.top}px`}
						style:bottom={`${PLOT_GRID.bottom}px`}
						style:left={`${PLOT_GRID.left}px`}
						style:right={`${PLOT_GRID.right}px`}
					>
						<div
							class="pointer-events-auto absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize"
							style:left={`${markerPercent}%`}
							role="separator"
							aria-label="X marker"
							aria-orientation="vertical"
							tabindex="-1"
							onpointerdown={startMarkerDrag}
							onpointermove={dragMarker}
							onpointerup={stopMarkerDrag}
							onpointercancel={stopMarkerDrag}
						>
							<span class="absolute inset-y-0 left-1/2 border-l border-current"></span>
						</div>
					</div>
				{/if}
			</ContextMenu.Trigger>
			<ContextMenu.Content class="w-52">
				<ContextMenu.Item onSelect={() => zoomBy(0.5)}>
					<PlusIcon />
					Zoom in
				</ContextMenu.Item>
				<ContextMenu.Item onSelect={() => zoomBy(2)}>
					<MinusIcon />
					Zoom out
				</ContextMenu.Item>
				<ContextMenu.Item disabled={isFitAll} onSelect={resetZoom}>
					<ExpandIcon />
					Zoom to full extent
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					disabled={contextMenuX === null}
					onSelect={() => {
						if (contextMenuX !== null) placeMarkerAt(contextMenuX);
					}}
				>
					<SeparatorVerticalIcon />
					Place marker here
				</ContextMenu.Item>
				<ContextMenu.Item onSelect={toggleMarker}>
					<SeparatorVerticalIcon />
					{markerEnabled ? 'Hide x marker' : 'Show x marker'}
				</ContextMenu.Item>
				<ContextMenu.Item onSelect={toggleBoxZoom}>
					<BoxSelectIcon />
					{boxZoomEnabled ? 'Use drag pan' : 'Use box zoom'}
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					disabled={plotData.selectedSignalKeys.size === 0}
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

	{#if plotReady}
		{#if !hasPlottableSignals}
			<div
				class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
			>
				Select signals from the DBC side panel to view them.
			</div>
		{/if}

		{#if hasPlottableSignals && legendVisible}
			<SignalPlotLegend
				views={signalViews}
				{displayedMarkerX}
				{markerValues}
				{measurementStartMs}
				timestampMode={timestampMode.current}
			/>
		{/if}
	{:else}
		<div
			class="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
		>
			{#if chartError}
				{chartError}
			{:else}
				Select signals from the DBC side panel to view them.
			{/if}
		</div>
	{/if}
</section>
