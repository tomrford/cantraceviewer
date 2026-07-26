<script lang="ts">
	import {
		crosshairById,
		type LegendCrosshairMode,
		type PlotCrosshair
	} from '$lib/plot-crosshair.js';
	import type { YAxisId } from '$lib/plot-axes.js';
	import { ratioInRange, valueAtRatio, type PlotAxisRange } from '$lib/plot-viewport.js';
	import {
		formatAxisTime,
		formatAxisValue,
		formatTimeDelta,
		type LegendSignalValue,
		type SignalView
	} from '$lib/signal-plot-data.js';
	import type { TimestampMode } from '$lib/stores/preferences.svelte.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import LegendAxisGroup from './legend-axis-group.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';

	type LegendAxis = {
		id: YAxisId;
		index: number;
		label: string;
		color: string | null;
		unit: string | null;
		signals: SignalView[];
	};

	let {
		axes,
		axisRanges,
		canAddAxis,
		crosshairs,
		measurementStartMs,
		mode = $bindable('c1'),
		onAddAxis,
		onMove,
		onMoveToNewAxis,
		onRemoveAxis,
		selectOpen = $bindable(false), // eslint-disable-line no-useless-assignment
		signalValues,
		timestampMode
	}: {
		axes: LegendAxis[];
		axisRanges: ReadonlyMap<YAxisId, PlotAxisRange>;
		canAddAxis: boolean;
		crosshairs: PlotCrosshair[];
		measurementStartMs?: number | null;
		mode?: LegendCrosshairMode;
		onAddAxis: () => void;
		onMove: (signalKey: string, axisId: YAxisId) => void;
		onMoveToNewAxis: (signalKey: string) => void;
		onRemoveAxis: (axisId: YAxisId) => void;
		selectOpen?: boolean;
		signalValues: LegendSignalValue[];
		timestampMode: TimestampMode;
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
	const multiAxis = $derived(axes.length > 1);
	const axisTargets = $derived(axes.map((axis) => ({ id: axis.id, label: axis.label })));
	// The crosshair's y is anchored to the primary axis, so every other axis
	// reads its own value off the same screen row.
	const primaryRange = $derived(
		axes[0] === undefined ? null : (axisRanges.get(axes[0].id) ?? null)
	);

	// The mode select and the per-signal move menus float above the plot, so any
	// of them being open has to suspend plot interaction underneath.
	let selectMenuOpen = $state(false);
	let openMoveMenus = $state(0);
	const overlayOpen = $derived(selectMenuOpen || openMoveMenus > 0);

	$effect(() => {
		selectOpen = overlayOpen;
	});

	function yText(value: number): string {
		return formatAxisValue(value) ?? '-';
	}

	/** The crosshair readout for one axis, expressed in that axis's own scale. */
	function axisCursorText(axisId: YAxisId): string | null {
		const range = axisRanges.get(axisId);
		if (range === undefined || primaryRange === null) return null;

		if (mode === 'delta') {
			if (c1 === null || c2 === null) return null;
			const rowSpan = ratioInRange(primaryRange, c1.y) - ratioInRange(primaryRange, c2.y);
			return `Δy ${yText(rowSpan * (range.max - range.min))}`;
		}

		if (activeCrosshair === null) return null;
		return `y ${yText(valueAtRatio(range, ratioInRange(primaryRange, activeCrosshair.y)))}`;
	}

	function trackMoveMenu(open: boolean): void {
		openMoveMenus = Math.max(0, openMoveMenus + (open ? 1 : -1));
	}
</script>

<div
	class={[
		'absolute top-3 right-3 z-50 max-h-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-border/70 bg-popover/90 p-3 text-popover-foreground shadow-sm backdrop-blur',
		// Axis sections add a grip column and a per-axis readout, so the signal
		// names need the extra room to stay legible.
		multiAxis ? 'w-[22rem]' : 'w-80'
	]}
>
	{#if selectedOption !== undefined}
		<div class="mb-3 flex items-center justify-between gap-2">
			<span class="text-xs font-medium text-muted-foreground">Legend values</span>
			<Select.Root
				type="single"
				bind:open={selectMenuOpen}
				value={mode}
				onValueChange={(value: string) => (mode = value as LegendCrosshairMode)}
			>
				<Select.Trigger class="w-36">
					<span>{selectedOption.label}</span>
				</Select.Trigger>
				<Select.Content preventScroll={false}>
					{#each options as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<div class={multiAxis ? 'space-y-1' : 'space-y-2'}>
		{#each axes as axis (axis.id)}
			<LegendAxisGroup
				group={axis}
				label={axis.label}
				unit={axis.unit}
				color={axis.color}
				showHeader={multiAxis}
				{showValues}
				{valuesByKey}
				{axisTargets}
				{canAddAxis}
				{onMove}
				{onMoveToNewAxis}
				cursorText={multiAxis ? axisCursorText(axis.id) : null}
				onRemove={axis.index === 0 ? null : () => onRemoveAxis(axis.id)}
				onOverlay={trackMoveMenu}
			/>
		{/each}
	</div>

	{#if canAddAxis}
		<button
			type="button"
			class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
			onclick={onAddAxis}
		>
			<PlusIcon class="size-3.5" />
			Add Y axis
		</button>
	{/if}

	{#if mode === 'delta' && c1 !== null && c2 !== null}
		<div class="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
			C2 − C1 · Δt {formatTimeDelta(c2.x - c1.x)}{multiAxis ? '' : ` · Δy ${yText(c2.y - c1.y)}`}
		</div>
	{:else if activeCrosshair !== null}
		<div class="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
			C{activeCrosshair.id} · {formatAxisTime(activeCrosshair.x, {
				measurementStartMs,
				mode: timestampMode
			})}{multiAxis ? '' : ` · y ${yText(activeCrosshair.y)}`}
		</div>
	{/if}
</div>
