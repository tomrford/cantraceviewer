<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { SIGNAL_COLORS } from '$lib/plot-colors.js';
	import { plotData, type PlotSignal } from '$lib/stores/plot-data.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import BoxSelectIcon from '@lucide/svelte/icons/box-select';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import ListIcon from '@lucide/svelte/icons/list';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SeparatorVerticalIcon from '@lucide/svelte/icons/separator-vertical';
	import { onDestroy, onMount } from 'svelte';
	import type { ChartGPUInstance, ChartGPUOptions, SeriesConfig } from 'chartgpu';

	type SignalView = {
		key: string;
		label: string;
		unit: string;
		color: string;
		x: Float64Array;
		y: Float64Array;
		points: number;
		latestText: string;
		factor: number;
		offset: number;
		valueDescriptions: PlotSignal['valueDescriptions'];
	};

	let container: HTMLDivElement;
	let chart: ChartGPUInstance | null = null;
	let createChart:
		| ((container: HTMLElement, options: ChartGPUOptions) => Promise<ChartGPUInstance>)
		| null = null;
	let chartError = $state<string | null>(null);
	let markerX = $state<number | null>(null);
	let markerDragPointerId = $state<number | null>(null);
	let zoomStart = $state(0);
	let zoomEnd = $state(100);
	let legendVisible = $state(true);
	let lastSignature = '';
	let resizeObserver: ResizeObserver | null = null;

	const PLOT_GRID = { left: 64, right: 24, top: 18, bottom: 44 };

	const readySignals = $derived(
		plotData.signals.filter((signal) => signal.series && signal.series.timesMs.length >= 2)
	);
	const waitingSignals = $derived(
		plotData.signals.filter((signal) => signal.isDecoding || signal.decodeError || !signal.series)
	);
	const signalViews = $derived(readySignals.map((signal) => signalView(signal)));
	const measurementStartMs = $derived(traceFile.entry?.metadata.measurementStartMs);
	const xDomain = $derived.by(() => signalXDomain(signalViews));
	const visibleXDomain = $derived.by(() =>
		xDomain === null ? null : zoomedDomain(xDomain, zoomStart, zoomEnd)
	);
	const markerPercent = $derived.by(() => {
		if (markerX === null || visibleXDomain === null) return null;
		const span = visibleXDomain.max - visibleXDomain.min;
		if (!(span > 0)) return null;
		const percent = ((markerX - visibleXDomain.min) / span) * 100;
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
			chart.on('zoomRangeChange', ({ start, end }) => {
				zoomStart = start;
				zoomEnd = end;
			});

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
		const signature = JSON.stringify({
			keys: signalViews.map((view) => [view.key, view.points]),
			measurementStartMs
		});

		if (signature === lastSignature) return;
		lastSignature = signature;
		chart?.setOption(chartOptions());
	});

	function chartOptions(): ChartGPUOptions {
		return {
			theme: {
				backgroundColor: '#09090b',
				textColor: '#e4e4e7',
				axisLineColor: '#3f3f46',
				axisTickColor: '#71717a',
				gridLineColor: 'rgba(244,244,245,0.1)',
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
				tickFormatter: (value) => formatAxisTime(value, measurementStartMs)
			},
			yAxis: { type: 'value', autoBounds: 'visible' },
			dataZoom: [{ type: 'inside', start: zoomStart, end: zoomEnd }],
			legend: { show: false },
			tooltip: { show: false },
			animation: false,
			palette: SIGNAL_COLORS,
			annotations: [],
			series: signalViews.map((view) => lineSeries(view))
		};
	}

	function zoomBy(factor: number) {
		const range = chart?.getZoomRange() ?? { start: 0, end: 100 };
		const center = (range.start + range.end) / 2;
		const span = Math.min(100, Math.max(0.01, (range.end - range.start) * factor));
		zoomStart = Math.max(0, center - span / 2);
		zoomEnd = Math.min(100, center + span / 2);
		chart?.setZoomRange(zoomStart, zoomEnd);
	}

	function resetZoom() {
		zoomStart = 0;
		zoomEnd = 100;
		chart?.setZoomRange(0, 100);
	}

	function toggleMarker() {
		if (markerX !== null) {
			markerX = null;
			return;
		}

		if (visibleXDomain === null) return;
		markerX = visibleXDomain.min + (visibleXDomain.max - visibleXDomain.min) / 2;
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
		if (x !== null) markerX = x;
	}

	function pointerToDataX(event: PointerEvent): number | null {
		if (visibleXDomain === null) return null;
		const rect = container.getBoundingClientRect();
		const plotLeft = rect.left + PLOT_GRID.left;
		const plotRight = rect.right - PLOT_GRID.right;
		const plotWidth = plotRight - plotLeft;
		if (!(plotWidth > 0)) return null;

		const plotX = Math.min(plotRight, Math.max(plotLeft, event.clientX));
		const ratio = (plotX - plotLeft) / plotWidth;
		return visibleXDomain.min + ratio * (visibleXDomain.max - visibleXDomain.min);
	}

	function lineSeries(view: SignalView): SeriesConfig {
		return {
			type: 'line',
			name: view.label,
			data: { x: view.x, y: view.y },
			color: view.color,
			lineStyle: { color: view.color, width: 1.5, opacity: 0.95 },
			sampling: 'lttb',
			samplingThreshold: 8_000
		};
	}

	function markerValue(view: SignalView, x: number) {
		return {
			key: view.key,
			text: formatDecodedValue(nearestValue(view, x), view)
		};
	}

	function signalView(signal: PlotSignal): SignalView {
		const series = signal.series;
		const sourceTimes = series?.timesMs ?? new Float64Array(0);
		const sourceValues = series?.values ?? new Float64Array(0);

		return {
			key: signal.key,
			label: signal.label,
			unit: signal.unit,
			color: signal.color,
			x: sourceTimes,
			y: sourceValues,
			points: sourceTimes.length,
			latestText: formatDecodedValue(sourceValues.at(-1) ?? null, signal),
			factor: signal.factor,
			offset: signal.offset,
			valueDescriptions: signal.valueDescriptions
		};
	}

	function signalXDomain(views: SignalView[]): { min: number; max: number } | null {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;

		for (const view of views) {
			const first = firstFiniteValue(view.x);
			const last = lastFiniteValue(view.x);
			if (first !== null) min = Math.min(min, first);
			if (last !== null) max = Math.max(max, last);
		}

		return Number.isFinite(min) && Number.isFinite(max) && min !== max ? { min, max } : null;
	}

	function firstFiniteValue(values: Float64Array): number | null {
		for (let index = 0; index < values.length; index += 1) {
			const value = values[index];
			if (Number.isFinite(value)) return value;
		}
		return null;
	}

	function lastFiniteValue(values: Float64Array): number | null {
		for (let index = values.length - 1; index >= 0; index -= 1) {
			const value = values[index];
			if (Number.isFinite(value)) return value;
		}
		return null;
	}

	function zoomedDomain(
		domain: { min: number; max: number },
		startPercent: number,
		endPercent: number
	): { min: number; max: number } {
		const span = domain.max - domain.min;
		return {
			min: domain.min + (startPercent / 100) * span,
			max: domain.min + (endPercent / 100) * span
		};
	}

	function nearestValue(view: SignalView, x: number): number | null {
		if (view.points === 0) return null;
		let low = 0;
		let high = view.points - 1;

		while (low < high) {
			const mid = Math.floor((low + high) / 2);
			if (view.x[mid] < x) low = mid + 1;
			else high = mid;
		}

		const previous = Math.max(0, low - 1);
		const nearest = Math.abs(view.x[previous] - x) <= Math.abs(view.x[low] - x) ? previous : low;
		return view.y[nearest];
	}

	function formatDecodedValue(
		value: number | null,
		context: Pick<PlotSignal, 'unit' | 'factor' | 'offset' | 'valueDescriptions'>
	): string {
		if (value === null || !Number.isFinite(value)) return '-';
		const formatted = Math.abs(value) >= 1000 ? value.toFixed(0) : value.toPrecision(4);
		const rawValue = physicalToRaw(value, context.factor, context.offset);
		const description =
			rawValue === null
				? undefined
				: context.valueDescriptions.find((item) => item.rawValue === rawValue)?.label;
		const withUnit = context.unit ? `${formatted} ${context.unit}` : formatted;
		return description ?? withUnit;
	}

	function physicalToRaw(value: number, factor: number, offset: number): number | null {
		if (!Number.isFinite(factor) || factor === 0 || !Number.isFinite(offset)) return null;
		const raw = (value - offset) / factor;
		const rounded = Math.round(raw);
		return Math.abs(raw - rounded) < 1e-6 ? rounded : null;
	}

	function formatAxisTime(value: number, measurementStartMs?: number | null): string {
		if (!Number.isFinite(value)) return '';
		if (measurementStartMs !== null && measurementStartMs !== undefined) {
			const date = new Date(measurementStartMs + value);
			return date.toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				fractionalSecondDigits: 3
			});
		}

		const seconds = value / 1000;
		if (seconds < 60) return `${seconds.toFixed(3)}s`;
		const minutes = Math.floor(seconds / 60);
		return `${minutes}m ${(seconds - minutes * 60).toFixed(3)}s`;
	}
</script>

<section class="relative min-h-0 flex-1 overflow-hidden bg-background">
	<div bind:this={container} class="absolute inset-0" aria-label="Selected signal plot"></div>

	{#if signalViews.length > 0}
		{#if markerPercent !== null}
			<div
				class="absolute z-40 text-emerald-500"
				style:top={`${PLOT_GRID.top}px`}
				style:bottom={`${PLOT_GRID.bottom}px`}
				style:left={`${PLOT_GRID.left}px`}
				style:right={`${PLOT_GRID.right}px`}
			>
				<div
					class="absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize"
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

		<div
			class="absolute top-3 right-3 z-50 flex gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur"
		>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Zoom in"
				title="Zoom in"
				onclick={() => zoomBy(0.5)}
			>
				<PlusIcon class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Zoom out"
				title="Zoom out"
				onclick={() => zoomBy(2)}
			>
				<MinusIcon class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Zoom to full extent"
				title="Zoom to full extent"
				onclick={resetZoom}
			>
				<ExpandIcon class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Box zoom (coming soon)"
				title="Box zoom (coming soon)"
				disabled
			>
				<BoxSelectIcon class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label={markerX === null ? 'Show x marker' : 'Hide x marker'}
				title={markerX === null ? 'Show x marker' : 'Hide x marker'}
				aria-pressed={markerX !== null}
				onclick={toggleMarker}
			>
				<SeparatorVerticalIcon class={`size-4 ${markerX !== null ? 'text-emerald-500' : ''}`} />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label={legendVisible ? 'Hide legend' : 'Show legend'}
				title={legendVisible ? 'Hide legend' : 'Show legend'}
				onclick={() => (legendVisible = !legendVisible)}
			>
				<ListIcon class={`size-4 ${legendVisible ? 'text-emerald-500' : ''}`} />
			</Button>
		</div>

		{#if legendVisible}
			<div
				class="absolute top-14 right-3 z-50 max-h-[calc(100%-4.25rem)] w-80 overflow-auto rounded-md border bg-background/90 p-3 shadow-sm backdrop-blur"
			>
				<div class="space-y-2">
					{#each signalViews as view (view.key)}
						{@const marker = markerValues.find((value) => value.key === view.key)}
						<div
							class="grid items-center gap-2 text-xs"
							class:grid-cols-[0.75rem_1fr_auto]={markerX !== null}
							class:grid-cols-[0.75rem_1fr]={markerX === null}
						>
							<span class="size-2 rounded-full" style:background-color={view.color}></span>
							<span class="min-w-0 truncate" title={view.label}>{view.label}</span>
							{#if markerX !== null}
								<span class="font-mono tabular-nums">{marker?.text}</span>
							{/if}
						</div>
					{/each}
				</div>
				{#if markerX !== null}
					<div class="mt-2 text-xs text-muted-foreground">
						{formatAxisTime(markerX, measurementStartMs)}
					</div>
				{/if}
			</div>
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
				Load a trace and select DBC signals.
			{/if}
		</div>
	{/if}
</section>
