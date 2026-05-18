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
		viewportIndicator,
		zoomViewport
	} from '$lib/plot-viewport.js';
	import {
		formatAxisTime,
		lineSeriesForViews,
		markerValue,
		signalDomain,
		signalView,
		visibleSignalViews
	} from '$lib/signal-plot-data.js';
	import SignalPlotLegend from './signal-plot-legend.svelte';
	import { plotData } from '$lib/stores/plot-data.svelte.js';
	import { themeState, timestampMode } from '$lib/stores/preferences.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { ChartGPUInstance, ChartGPUOptions } from 'chartgpu';

	let {
		dropActive = false,
		markerEnabled = $bindable(false),
		markerX = $bindable<number | null>(null),
		boxZoomEnabled = $bindable(false),
		legendVisible = $bindable(true),
		onPlotControlsChange,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLElement> & {
		dropActive?: boolean;
		markerEnabled?: boolean;
		markerX?: number | null;
		boxZoomEnabled?: boolean;
		legendVisible?: boolean;
		onPlotControlsChange?: (controls: {
			canResetZoom: boolean;
			zoomIn: () => void;
			zoomOut: () => void;
			resetZoom: () => void;
		}) => void;
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
	let lastSignature = '';
	let resizeObserver: ResizeObserver | null = null;

	const PLOT_GRID = { left: 64, right: 24, top: 18, bottom: 44 };
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

	const readySignals = $derived(
		plotData.signals.filter((signal) => signal.series && signal.series.timesMs.length >= 2)
	);
	const waitingSignals = $derived(
		plotData.signals.filter((signal) => signal.isDecoding || signal.decodeError || !signal.series)
	);
	const signalViews = $derived(readySignals.map((signal) => signalView(signal)));
	const measurementStartMs = $derived(traceFile.entry?.metadata.measurementStartMs);
	const fullDomain = $derived.by(() => signalDomain(signalViews));
	const activeViewport = $derived(viewport ?? fullDomain);
	const visibleViews = $derived(visibleSignalViews(signalViews, activeViewport));
	const isFitAll = $derived(viewportsAlmostEqual(activeViewport, fullDomain));
	const locationIndicator = $derived.by(() =>
		activeViewport === null || fullDomain === null
			? null
			: viewportIndicator(activeViewport, fullDomain)
	);
	const markerPercent = $derived.by(() => {
		if (markerX === null || activeViewport === null) return null;
		const span = activeViewport.xMax - activeViewport.xMin;
		if (!(span > 0)) return null;
		const percent = ((markerX - activeViewport.xMin) / span) * 100;
		if (percent < 0 || percent > 100) return null;
		return percent;
	});
	const markerValues = $derived.by(() => {
		const x = markerX;
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
			chartError = 'WebGPU is not available in this browser.';
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
		resizeObserver?.disconnect();
		chart?.dispose();
	});

	$effect(() => {
		onPlotControlsChange?.({
			canResetZoom: !isFitAll,
			zoomIn: () => zoomBy(0.5),
			zoomOut: () => zoomBy(2),
			resetZoom
		});
	});

	$effect(() => {
		if (!markerEnabled) {
			if (markerX !== null) markerX = null;
			return;
		}

		if (markerX !== null || activeViewport === null) return;
		markerX = activeViewport.xMin + (activeViewport.xMax - activeViewport.xMin) / 2;
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
			keys: signalViews.map((view) => [view.key, view.points]),
			measurementStartMs,
			isDark: themeState.isDark,
			timestampMode: timestampMode.current,
			viewport: activeViewport,
			visible: visibleViews.map((view) => [view.key, view.points])
		});

		if (signature === lastSignature) return;
		lastSignature = signature;
		chart?.setOption(chartOptions());
	});

	function chartOptions(): ChartGPUOptions {
		return {
			theme: {
				backgroundColor: themeState.isDark ? '#09090b' : '#ffffff',
				textColor: themeState.isDark ? '#e4e4e7' : '#18181b',
				axisLineColor: themeState.isDark ? '#3f3f46' : '#d4d4d8',
				axisTickColor: '#71717a',
				gridLineColor: themeState.isDark ? 'rgba(244,244,245,0.1)' : 'rgba(24,24,27,0.1)',
				colorPalette: SIGNAL_COLORS,
				fontFamily: 'Geist Variable, sans-serif',
				fontSize: 12
			},
			grid: PLOT_GRID,
			gridLines: {
				color: 'rgba(244,244,245,0.1)',
				horizontal: { count: 6 },
				vertical: { count: 8 }
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
				max: activeViewport?.yMax
			},
			legend: { show: false },
			tooltip: { show: false },
			animation: false,
			palette: SIGNAL_COLORS,
			annotations: [],
			series: lineSeriesForViews(visibleViews)
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
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function updateMarkerFromPointer(event: PointerEvent) {
		const x = pointerToDataX(event);
		if (x !== null) {
			markerEnabled = true;
			markerX = x;
		}
	}

	function pointerToDataX(event: PointerEvent): number | null {
		if (activeViewport === null) return null;
		const point = currentPlotRatio(event);
		if (point === null) return null;
		return activeViewport.xMin + point.xRatio * (activeViewport.xMax - activeViewport.xMin);
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
			class="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-background/25 text-sm font-medium text-foreground backdrop-blur-[1px]"
		>
			Drop trace to open
		</div>
	{/if}
	<div bind:this={container} class="absolute inset-0" aria-label="Selected signal plot"></div>

	{#if signalViews.length > 0}
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
					class="absolute border border-white/90 bg-white/10"
					style:left={`${Math.min(dragState.start.xRatio, dragState.current.xRatio) * 100}%`}
					style:top={`${Math.min(dragState.start.yRatio, dragState.current.yRatio) * 100}%`}
					style:width={`${Math.abs(dragState.current.xRatio - dragState.start.xRatio) * 100}%`}
					style:height={`${Math.abs(dragState.current.yRatio - dragState.start.yRatio) * 100}%`}
				></div>
			{/if}
		</button>

		{#if locationIndicator !== null && !isFitAll}
			<div
				class="pointer-events-none absolute z-50 h-1 overflow-hidden rounded-full bg-transparent"
				style:left={`${PLOT_GRID.left}px`}
				style:right={`${PLOT_GRID.right}px`}
				style:bottom={`${PLOT_GRID.bottom - 1}px`}
			>
				<span
					class="absolute inset-y-0 rounded-full bg-muted-foreground/60"
					style:left={`${locationIndicator.xLeft}%`}
					style:width={`${locationIndicator.xWidth}%`}
				></span>
			</div>
			<div
				class="pointer-events-none absolute z-50 w-1 overflow-hidden rounded-full bg-transparent"
				style:top={`${PLOT_GRID.top}px`}
				style:bottom={`${PLOT_GRID.bottom}px`}
				style:left={`${PLOT_GRID.left - 1}px`}
			>
				<span
					class="absolute inset-x-0 rounded-full bg-muted-foreground/60"
					style:top={`${locationIndicator.yTop}%`}
					style:height={`${locationIndicator.yHeight}%`}
				></span>
			</div>
		{/if}

		{#if markerPercent !== null}
			<div
				class="pointer-events-none absolute z-40 text-white"
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

		{#if legendVisible}
			<SignalPlotLegend
				views={signalViews}
				{markerX}
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
			{:else if waitingSignals.length > 0}
				Decode selected signals to plot them.
			{:else}
				Select signals from the DBC side panel to view them.
			{/if}
		</div>
	{/if}
</section>
