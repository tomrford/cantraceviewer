<script lang="ts">
	import { formatAxisTime, type SignalView, type markerValue } from '$lib/signal-plot-data.js';
	import type { TimestampMode } from '$lib/stores/preferences.svelte.js';

	let {
		measurementStartMs,
		markerX,
		markerValues,
		timestampMode,
		views
	}: {
		measurementStartMs?: number | null;
		markerX: number | null;
		markerValues: ReturnType<typeof markerValue>[];
		timestampMode: TimestampMode;
		views: SignalView[];
	} = $props();
</script>

<div
	class="absolute top-3 right-3 z-50 max-h-[calc(100%-1.5rem)] w-80 overflow-auto rounded-md border bg-background/90 p-3 shadow-sm backdrop-blur"
>
	<div class="space-y-2">
		{#each views as view (view.key)}
			{@const marker = markerValues.find((value) => value.key === view.key)}
			<div
				class="grid items-center gap-2 text-xs"
				class:grid-cols-[0.75rem_1fr_auto]={markerX !== null}
				class:grid-cols-[0.75rem_1fr]={markerX === null}
			>
				<span class="size-2 rounded-full" style:background-color={view.color}></span>
				<span class="flex min-w-0 font-mono" title={view.label}>
					<span class="min-w-[2ch] shrink truncate">{view.messageName}</span>
					<span class="shrink-0">.</span>
					<span class="min-w-0 flex-[999_1_auto] truncate">{view.signalName}</span>
				</span>
				{#if markerX !== null}
					<span class="font-mono tabular-nums">{marker?.text}</span>
				{/if}
			</div>
		{/each}
	</div>
	{#if markerX !== null}
		<div class="mt-2 text-xs text-muted-foreground">
			{formatAxisTime(markerX, {
				measurementStartMs,
				mode: timestampMode
			})}
		</div>
	{/if}
</div>
