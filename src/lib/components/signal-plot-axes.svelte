<script lang="ts">
	import {
		axisGutterOffset,
		axisTicks,
		axisTicksAtRatios,
		Y_AXIS_GUTTER,
		type AxisTickGenerator,
		type PlotGrid
	} from '$lib/plot-axis-layout.js';
	import type { YAxisId } from '$lib/plot-axes.js';
	import { formatAxisValue } from '$lib/signal-plot-data.js';
	import type { PlotAxisRange } from '$lib/plot-viewport.js';

	let {
		axes,
		generateTicks,
		grid,
		numbered,
		primaryAxisId,
		primaryRange,
		ranges
	}: {
		axes: { id: YAxisId; index: number; label: string }[];
		generateTicks: AxisTickGenerator;
		grid: PlotGrid;
		numbered: boolean;
		primaryAxisId: YAxisId;
		primaryRange: PlotAxisRange | null;
		ranges: ReadonlyMap<YAxisId, PlotAxisRange>;
	} = $props();

	const columns = $derived.by(() => {
		const primaryTicks = axisTicks(primaryRange, generateTicks);
		const ratios = primaryTicks.map((tick) => tick.ratio);
		return axes.map((axis, position) => ({
			...axis,
			offset: axisGutterOffset(position, axes.length),
			ticks:
				axis.id === primaryAxisId
					? primaryTicks
					: axisTicksAtRatios(ranges.get(axis.id) ?? null, ratios)
		}));
	});
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
						class="absolute right-2.5 -translate-y-1/2 font-mono text-xs leading-none text-muted-foreground tabular-nums"
						style:top={`${tick.ratio * 100}%`}
					>
						{text}
					</span>
				{/if}
			{/each}

			{#if numbered}
				<span
					class="absolute top-full right-2.5 mt-2 rounded-sm bg-muted-foreground px-1 font-mono text-[0.625rem] leading-4 font-semibold text-background"
					title={column.label}
				>
					Y{column.index + 1}
				</span>
			{/if}
		</div>
	{/each}
</div>
