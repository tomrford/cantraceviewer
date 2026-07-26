<script lang="ts">
	import {
		axisGutterOffset,
		axisTicks,
		Y_AXIS_GUTTER,
		type PlotGrid
	} from '$lib/plot-axis-layout.js';
	import type { YAxisId } from '$lib/plot-axes.js';
	import { formatAxisValue } from '$lib/signal-plot-data.js';
	import type { PlotAxisRange } from '$lib/plot-viewport.js';

	let {
		axes,
		grid,
		ranges
	}: {
		axes: { id: YAxisId; index: number; label: string; color: string | null }[];
		grid: PlotGrid;
		ranges: ReadonlyMap<YAxisId, PlotAxisRange>;
	} = $props();

	// ChartGPU anchors every left axis at the same edge and never renders the y
	// axis line at all, so the app owns this chrome: one gutter per axis, stacked
	// outwards from the plot, on the same tick rows as the grid lines.
	const columns = $derived(
		axes.map((axis) => ({
			...axis,
			offset: axisGutterOffset(axis.index, axes.length),
			ticks: axisTicks(ranges.get(axis.id) ?? null)
		}))
	);
	const numbered = $derived(axes.length > 1);
</script>

<div class="pointer-events-none absolute inset-0 z-20">
	{#each columns as column (column.id)}
		<div
			class="absolute"
			style:left={`${column.offset}px`}
			style:width={`${Y_AXIS_GUTTER}px`}
			style:top={`${grid.top}px`}
			style:bottom={`${grid.bottom}px`}
			role="presentation"
			aria-label={column.label}
		>
			<span class="absolute inset-y-0 right-0 border-r border-border"></span>

			{#each column.ticks as tick (tick.ratio)}
				{@const text = formatAxisValue(tick.value)}
				{#if text !== null}
					<span
						class="absolute right-2.5 -translate-y-1/2 font-mono text-[0.6875rem] leading-none tabular-nums"
						style:top={`${tick.ratio * 100}%`}
						style:color={column.color ?? undefined}
						class:text-muted-foreground={column.color === null}
					>
						{text}
					</span>
				{/if}
			{/each}

			{#if numbered}
				<span
					class="absolute top-full right-2.5 mt-2 rounded-sm px-1 font-mono text-[0.625rem] leading-4 font-semibold text-background"
					style:background-color={column.color ?? undefined}
					class:bg-muted-foreground={column.color === null}
					title={column.label}
				>
					Y{column.index + 1}
				</span>
			{/if}
		</div>
	{/each}
</div>
