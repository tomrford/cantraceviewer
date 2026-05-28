<script lang="ts">
	import {
		formatAxisTime,
		type LegendMarkerValue,
		type SignalView
	} from '$lib/signal-plot-data.js';
	import type { TimestampMode } from '$lib/stores/preferences.svelte.js';

	let {
		measurementStartMs,
		displayedMarkerX,
		markerValues,
		timestampMode,
		views
	}: {
		measurementStartMs?: number | null;
		displayedMarkerX: number | null;
		markerValues: LegendMarkerValue[];
		timestampMode: TimestampMode;
		views: SignalView[];
	} = $props();

	const markerValuesByKey = $derived(new Map(markerValues.map((value) => [value.key, value])));
</script>

<div
	class="absolute top-3 right-3 z-50 max-h-[calc(100%-1.5rem)] w-80 overflow-auto rounded-md border bg-background/90 p-3 shadow-sm backdrop-blur"
>
	<div class="space-y-2">
		{#each views as view (view.key)}
			{@const marker = markerValuesByKey.get(view.key)}
			<div
				class="grid min-w-0 items-center gap-2 text-xs"
				class:grid-cols-[0.75rem_minmax(0,1fr)_auto]={displayedMarkerX !== null}
				class:grid-cols-[0.75rem_minmax(0,1fr)]={displayedMarkerX === null}
			>
				<span class="size-2 rounded-full" style:background-color={view.color}></span>
				<span class="flex min-w-0" title={view.label}>
					<span class="min-w-0 flex-[0_1_max-content] truncate">{view.signalName}</span>
					<span class="text-muted-foreground">&nbsp;(</span>
					<span class="min-w-0 flex-[0_9999_auto] truncate text-muted-foreground">
						{view.messageName}
					</span>
					<span class="text-muted-foreground">)</span>
				</span>
				{#if displayedMarkerX !== null}
					<span
						class="font-mono tabular-nums"
						class:text-destructive={marker?.outOfRange}
						title={marker?.outOfRange
							? `Outside DBC range [${view.minimum}, ${view.maximum}]`
							: undefined}
					>
						{marker?.text}
					</span>
				{/if}
			</div>
		{/each}
	</div>
	{#if displayedMarkerX !== null}
		<div class="mt-2 text-xs text-muted-foreground">
			{formatAxisTime(displayedMarkerX, {
				measurementStartMs,
				mode: timestampMode
			})}
		</div>
	{/if}
</div>
