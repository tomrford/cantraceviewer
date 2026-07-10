<script lang="ts">
	import {
		crosshairById,
		type LegendCrosshairMode,
		type PlotCrosshair
	} from '$lib/plot-crosshair.js';
	import {
		formatAxisTime,
		formatAxisValue,
		formatTimeDelta,
		type LegendSignalValue,
		type SignalView
	} from '$lib/signal-plot-data.js';
	import type { TimestampMode } from '$lib/stores/preferences.svelte.js';
	import * as Select from '$lib/components/ui/select/index.js';

	let {
		measurementStartMs,
		crosshairs,
		mode = $bindable('c1'),
		signalValues,
		timestampMode,
		views
	}: {
		measurementStartMs?: number | null;
		crosshairs: PlotCrosshair[];
		mode?: LegendCrosshairMode;
		signalValues: LegendSignalValue[];
		timestampMode: TimestampMode;
		views: SignalView[];
	} = $props();

	const c1 = $derived(crosshairById(crosshairs, 1));
	const c2 = $derived(crosshairById(crosshairs, 2));
	const options = $derived.by(() => {
		const next: { value: LegendCrosshairMode; label: string }[] = [];
		if (c1 !== null) next.push({ value: 'c1', label: 'Value at C1' });
		if (c2 !== null) next.push({ value: 'c2', label: 'Value at C2' });
		if (c1 !== null && c2 !== null) next.push({ value: 'delta', label: 'Delta C2 − C1' });
		return next;
	});
	const selectedOption = $derived(options.find((option) => option.value === mode) ?? options[0]);
	const activeCrosshair = $derived(mode === 'c1' ? c1 : mode === 'c2' ? c2 : null);
	const valuesByKey = $derived(new Map(signalValues.map((value) => [value.key, value])));
	const showValues = $derived(crosshairs.length > 0);

	function yText(value: number): string {
		return formatAxisValue(value) ?? '-';
	}
</script>

<div
	class="absolute top-3 right-3 z-50 max-h-[calc(100%-1.5rem)] w-80 overflow-auto rounded-lg border border-border/70 bg-popover/90 p-3 text-popover-foreground shadow-sm backdrop-blur"
>
	{#if selectedOption !== undefined}
		<div class="mb-3 flex items-center justify-between gap-2">
			<span class="text-xs font-medium text-muted-foreground">Legend values</span>
			<Select.Root
				type="single"
				value={mode}
				onValueChange={(value: string) => (mode = value as LegendCrosshairMode)}
			>
				<Select.Trigger class="w-36">
					<span>{selectedOption.label}</span>
				</Select.Trigger>
				<Select.Content>
					{#each options as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<div class="space-y-2">
		{#each views as view (view.key)}
			{@const value = valuesByKey.get(view.key)}
			<div
				class="grid min-w-0 items-center gap-2 text-xs"
				class:grid-cols-[0.75rem_minmax(0,1fr)_auto]={showValues}
				class:grid-cols-[0.75rem_minmax(0,1fr)]={!showValues}
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
				{#if showValues}
					<span
						class="font-mono tabular-nums"
						class:text-destructive={value?.outOfRange}
						title={value?.outOfRange
							? `Outside DBC range [${view.minimum}, ${view.maximum}]`
							: undefined}
					>
						{value?.text ?? '-'}
					</span>
				{/if}
			</div>
		{/each}
	</div>

	{#if mode === 'delta' && c1 !== null && c2 !== null}
		<div class="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
			C2 − C1 · Δt {formatTimeDelta(c2.x - c1.x)} · Δy {yText(c2.y - c1.y)}
		</div>
	{:else if activeCrosshair !== null}
		<div class="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
			C{activeCrosshair.id} · {formatAxisTime(activeCrosshair.x, {
				measurementStartMs,
				mode: timestampMode
			})} · y {yText(activeCrosshair.y)}
		</div>
	{/if}
</div>
