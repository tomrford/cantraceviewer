<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { SIGNAL_COLORS } from '$lib/plot-colors.js';
	import { plotData, type PlotSignal } from '$lib/stores/plot-data.svelte.js';
	import { traceFile } from '$lib/stores/trace-file.svelte.js';
	import type { SignalSample } from '$lib/wasm.js';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { onDestroy, onMount } from 'svelte';
	import type { AnnotationConfig, ChartGPUInstance, ChartGPUOptions, SeriesConfig } from 'chartgpu';

	type SignalView = {
		key: string;
		label: string;
		unit: string;
		color: string;
		x: Float64Array;
		y: Float64Array;
		points: number;
		latestText: string;
	};

	let container: HTMLDivElement;
	let chart: ChartGPUInstance | null = null;
	let createChart:
		| ((container: HTMLElement, options: ChartGPUOptions) => Promise<ChartGPUInstance>)
		| null = null;
	let chartError = $state<string | null>(null);
	let markerX = $state<number | null>(null);
	let zoomStart = $state(0);
	let zoomEnd = $state(100);
	let lastSignature = '';
	let resizeObserver: ResizeObserver | null = null;

	const readySignals = $derived(
		plotData.signals.filter((signal) => signal.samples && signal.samples.length >= 2)
	);
	const waitingSignals = $derived(
		plotData.signals.filter((signal) => signal.isDecoding || signal.decodeError || !signal.samples)
	);
	const signalViews = $derived(
		readySignals.map((signal) => signalView(signal, traceFile.entry?.metadata.measurementStartMs))
	);
	const totalPoints = $derived(signalViews.reduce((sum, view) => sum + view.points, 0));
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
			chart.onInteractionXChange((x) => {
				markerX = x;
			});
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
			markerX
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
			grid: { left: 64, right: 24, top: 18, bottom: 44 },
			gridLines: {
				color: 'rgba(244,244,245,0.1)',
				horizontal: { count: 6 },
				vertical: { count: 8 }
			},
			xAxis: {
				type: 'time',
				tickFormatter: (value) => formatAxisTime(value)
			},
			yAxis: { type: 'value', autoBounds: 'visible' },
			dataZoom: [{ type: 'inside', start: zoomStart, end: zoomEnd }],
			legend: { show: false },
			tooltip: { show: false },
			animation: false,
			palette: SIGNAL_COLORS,
			annotations: markerX === null ? [] : [markerAnnotation(markerX)],
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
		markerX = null;
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

	function markerAnnotation(x: number): AnnotationConfig {
		return {
			id: 'marker',
			type: 'lineX',
			x,
			layer: 'aboveSeries',
			style: { color: '#f4f4f5', lineWidth: 1, lineDash: [6, 4], opacity: 0.85 }
		};
	}

	function markerValue(view: SignalView, x: number) {
		return {
			key: view.key,
			text: formatSampleValue(nearestValue(view, x), view.unit)
		};
	}

	function signalView(
		signal: PlotSignal,
		measurementStartMs: number | null | undefined
	): SignalView {
		const samples = signal.samples ?? [];
		const x = new Float64Array(samples.length);
		const y = new Float64Array(samples.length);

		for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
			x[sampleIndex] = sampleTimeMs(samples[sampleIndex], measurementStartMs);
			y[sampleIndex] = samples[sampleIndex].value;
		}

		return {
			key: signal.key,
			label: signal.label,
			unit: signal.unit,
			color: signal.color,
			x,
			y,
			points: samples.length,
			latestText: formatSampleValue(samples.at(-1)?.value ?? null, signal.unit)
		};
	}

	function sampleTimeMs(
		sample: SignalSample,
		measurementStartMs: number | null | undefined
	): number {
		const relativeMs = Number(sample.timestampNs) / 1_000_000;
		return measurementStartMs === null || measurementStartMs === undefined
			? relativeMs
			: measurementStartMs + relativeMs;
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

	function formatSampleValue(value: number | null, unit: string): string {
		if (value === null || !Number.isFinite(value)) return '-';
		const formatted = Math.abs(value) >= 1000 ? value.toFixed(0) : value.toPrecision(4);
		return unit ? `${formatted} ${unit}` : formatted;
	}

	function formatAxisTime(value: number): string {
		if (!Number.isFinite(value)) return '';
		const date = new Date(value);
		if (value > 946_684_800_000) {
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
		<div
			class="absolute top-3 right-[21.5rem] z-50 flex flex-col gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur"
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
				aria-label="Reset zoom"
				title="Reset zoom"
				onclick={resetZoom}
			>
				<RotateCcwIcon class="size-4" />
			</Button>
		</div>

		<div
			class="absolute top-3 right-3 max-h-64 w-80 overflow-auto rounded-md border bg-background/90 p-3 shadow-sm backdrop-blur"
		>
			<div class="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
				<span>{markerX === null ? 'Latest values' : formatAxisTime(markerX)}</span>
				<span>{totalPoints.toLocaleString()} pts</span>
			</div>
			<div class="space-y-2">
				{#each signalViews as view (view.key)}
					{@const marker = markerValues.find((value) => value.key === view.key)}
					<div class="grid grid-cols-[0.75rem_1fr_auto] items-center gap-2 text-xs">
						<span class="size-2 rounded-full" style:background-color={view.color}></span>
						<span class="min-w-0 truncate" title={view.label}>{view.label}</span>
						<span class="font-mono tabular-nums">{marker?.text}</span>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div
			class="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
		>
			{#if chartError}
				{chartError}
			{:else if waitingSignals.length > 0}
				Decode selected signals to plot them.
			{:else}
				Load an ASC trace and select DBC signals.
			{/if}
		</div>
	{/if}
</section>
