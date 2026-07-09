<script lang="ts">
	import { SIGNAL_COLORS } from '$lib/plot-colors.js';
	import { type PlotViewport, viewportCenterX } from '$lib/plot-viewport.js';
	import {
		createSignalViewCache,
		formatAxisValue,
		formatAxisTime,
		lineSeriesForViews,
		markerValue,
		signalDomain
	} from '$lib/signal-plot-data.js';
	import { PlotWindow } from '$lib/plot-window.svelte.js';
	import { PlotViewportState } from '$lib/plot-viewport-state.svelte.js';
	import PlotInteraction from './plot-interaction.svelte';
	import PlotMarker from './plot-marker.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import SignalPlotLegend from './signal-plot-legend.svelte';
	import { createPlotPerfStats } from '$lib/plot-perf.js';
	import { isPlottableSignal, plotData } from '$lib/stores/plot-data.svelte.js';
	import { isDark, timestampMode } from '$lib/stores/preferences.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import { onDestroy, onMount } from 'svelte';
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
		viewport,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLElement> & {
		dropActive?: boolean;
		markerEnabled?: boolean;
		markerX?: number | null;
		boxZoomEnabled?: boolean;
		legendVisible?: boolean;
		viewport: PlotViewportState;
	} = $props();
	let container: HTMLDivElement;
	let chart: ChartGPUInstance | null = null;
	let chartError = $state<string | null>(null);
	let contextMenuX = $state<number | null>(null);
	let resizeObserver: ResizeObserver | null = null;

	const PLOT_GRID = { left: 64, right: 24, top: 18, bottom: 44 };
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
	let lastDomainValue: PlotViewport | null = null;
	const fullDomain = $derived.by(() => {
		const next = signalDomain(signalViews) ?? traceDurationDomain(traceDurationNs);
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
	const chartSeries = $derived(lineSeriesForViews(windowedViews));

	$effect(() => {
		plotWindow.settleAfter(signalViews, activeViewport);
	});
	const isFitAll = $derived(viewport.isFitAll);
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
				text: view.latestText,
				outOfRange: false
			}));
		}

		return signalViews.map((view) => markerValue(view, x));
	});
	onMount(() => {
		viewport.domainSource = () => fullDomain;
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
		plotWindow.dispose();
		resizeObserver?.disconnect();
		chart?.dispose();
	});

	$effect(() => {
		if (!hasPlottableSignals) {
			markerEnabled = false;
			markerX = null;
			boxZoomEnabled = false;
			contextMenuX = null;
			viewport.reset();
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

	function rememberContextMenuPoint(x: number | null) {
		contextMenuX = x;
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
			<ContextMenu.Trigger class="contents" disabled={!hasPlottableSignals}>
				<PlotInteraction
					{viewport}
					{boxZoomEnabled}
					grid={PLOT_GRID}
					onContextMenuPoint={rememberContextMenuPoint}
				/>

				{#if markerPercent !== null}
					<PlotMarker
						viewport={activeViewport}
						grid={PLOT_GRID}
						percent={markerPercent}
						onMarkerX={placeMarkerAt}
						onContextMenuPoint={rememberContextMenuPoint}
					/>
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

	{#if hasPlottableSignals && legendVisible}
		<SignalPlotLegend
			views={signalViews}
			{displayedMarkerX}
			{markerValues}
			{measurementStartMs}
			timestampMode={timestampMode.current}
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
