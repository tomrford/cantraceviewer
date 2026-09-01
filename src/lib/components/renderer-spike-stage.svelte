<script lang="ts">
	import PlotInteraction from '$lib/components/plot-interaction.svelte';
	import { plotGrid } from '$lib/plot-axis-layout.js';
	import { PlotViewportState } from '$lib/plot-viewport-state.svelte.js';
	import {
		createChartgpuDriver,
		createTanstackDriver,
		type RendererId,
		type SpikeDriver
	} from '$lib/renderer-spike/drivers.js';
	import {
		SPIKE_PLOT_HEIGHT,
		spikeWorkload,
		type SpikeViewport
	} from '$lib/renderer-spike/workload.js';
	import { onMount } from 'svelte';

	let {
		renderer,
		overlay = false
	}: {
		renderer: RendererId;
		overlay?: boolean;
	} = $props();

	const workload = spikeWorkload();
	const viewport = new PlotViewportState();
	const grid = plotGrid(2);
	let stage = $state<HTMLDivElement | null>(null);
	let surface = $state<HTMLDivElement | null>(null);
	let error = $state<string | null>(null);
	let ready = $state(false);
	let driver: SpikeDriver | null = null;
	const spikeView = $derived.by((): SpikeViewport => {
		const active = viewport.activeViewport;
		if (active === null) return workload.fit;
		return {
			xMin: active.xMin,
			xMax: active.xMax,
			primary: { min: active.yMin, max: active.yMax },
			secondary: viewport.secondaryRanges.get('y2') ?? workload.fit.secondary
		};
	});

	onMount(() => {
		viewport.domainSource = () => ({
			xMin: workload.fit.xMin,
			xMax: workload.fit.xMax,
			yMin: workload.fit.primary.min,
			yMax: workload.fit.primary.max
		});
		viewport.secondaryRangeSource = () => new Map([['y2', workload.fit.secondary]]);

		const host = surface;
		if (host === null) {
			error = 'Plot surface was not mounted.';
			return;
		}

		const created = createDriver(renderer);
		driver = created;
		void (async () => {
			try {
				const available = await created.available();
				if (!available) {
					error = `${created.label} is not available here.`;
					return;
				}
				await created.mount(host, spikeView, {
					width: host.clientWidth || 960,
					height: host.clientHeight || SPIKE_PLOT_HEIGHT
				});
				ready = true;
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		})();

		return () => {
			ready = false;
			viewport.domainSource = null;
			viewport.secondaryRangeSource = null;
			created.destroy();
			driver = null;
		};
	});

	$effect(() => {
		if (!ready || driver === null) return;
		driver.domainUpdate(spikeView, {
			width: surface?.clientWidth || 960,
			height: surface?.clientHeight || SPIKE_PLOT_HEIGHT
		});
	});

	function createDriver(id: RendererId): SpikeDriver {
		if (id === 'chartgpu') return createChartgpuDriver(workload);
		return createTanstackDriver(workload, id === 'tanstack-canvas' ? 'canvas' : 'svg');
	}
</script>

<div
	bind:this={stage}
	class="relative min-h-0 w-full overflow-hidden bg-background"
	style:height="{SPIKE_PLOT_HEIGHT}px"
>
	<div bind:this={surface} class="absolute inset-0" aria-label="Renderer spike plot"></div>
	{#if overlay}
		<PlotInteraction
			{viewport}
			boxZoomEnabled={false}
			suspended={false}
			{grid}
			eventRoot={stage}
			plotSurface={surface}
		/>
	{/if}
	{#if error}
		<p
			class="absolute inset-0 z-10 flex items-center justify-center bg-background/80 px-4 text-sm text-destructive"
		>
			{error}
		</p>
	{/if}
</div>
