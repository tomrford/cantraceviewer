<script lang="ts">
	import LegendSignalRow from './legend-signal-row.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { YAxisId } from '$lib/plot-axes.js';
	import type { LegendSignalValue, SignalView } from '$lib/signal-plot-data.js';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	let {
		axisTargets,
		canAddAxis,
		cursorText,
		group,
		label,
		color,
		onMove,
		onMoveToNewAxis,
		onOverlay,
		onRemove,
		showHeader,
		showValues,
		valuesByKey
	}: {
		axisTargets: { id: YAxisId; label: string }[];
		canAddAxis: boolean;
		/** Value or delta the crosshairs read on this axis, in this axis's own scale. */
		cursorText: string | null;
		group: { id: YAxisId; index: number; signals: SignalView[] };
		label: string;
		color: string | null;
		onMove: (signalKey: string, axisId: YAxisId) => void;
		onMoveToNewAxis: (signalKey: string) => void;
		onOverlay: (open: boolean) => void;
		onRemove: (() => void) | null;
		showHeader: boolean;
		showValues: boolean;
		valuesByKey: ReadonlyMap<string, LegendSignalValue>;
	} = $props();

	let dropActive = $state(false);

	function allowDrop(event: DragEvent): void {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropActive = true;
	}

	function drop(event: DragEvent): void {
		event.preventDefault();
		dropActive = false;
		const signalKey = event.dataTransfer?.getData('text/plain');
		if (signalKey) onMove(signalKey, group.id);
	}
</script>

<div
	class={[
		'rounded-md',
		showHeader ? 'border border-transparent p-1.5' : '',
		dropActive ? 'border-dashed !border-ring bg-accent/40' : ''
	]}
	role="group"
	aria-label={label}
	ondragover={allowDrop}
	ondragleave={() => (dropActive = false)}
	ondrop={drop}
>
	{#if showHeader}
		<div class="mb-1.5 flex items-center gap-2 text-xs">
			<span
				class="rounded-sm px-1 font-mono text-[0.625rem] leading-4 font-semibold text-background"
				style:background-color={color ?? undefined}
				class:bg-muted-foreground={color === null}
			>
				Y{group.index + 1}
			</span>
			<span class="min-w-0 flex-1 truncate text-muted-foreground" title={label}>{label}</span>
			{#if cursorText !== null}
				<span class="font-mono text-muted-foreground tabular-nums">{cursorText}</span>
			{/if}
			{#if onRemove !== null}
				<Button
					variant="ghost"
					size="icon"
					class="size-5 text-muted-foreground hover:text-destructive"
					aria-label={`Remove ${label}`}
					onclick={onRemove}
				>
					<Trash2Icon class="size-3" />
				</Button>
			{/if}
		</div>
	{/if}

	{#if group.signals.length === 0}
		<p class="px-1 py-2 text-xs text-muted-foreground italic">Drag signals here.</p>
	{:else}
		<div class="space-y-2" role="list">
			{#each group.signals as view (view.key)}
				<LegendSignalRow
					{view}
					value={valuesByKey.get(view.key)}
					showValue={showValues}
					{axisTargets}
					currentAxisId={group.id}
					{canAddAxis}
					draggable={axisTargets.length > 1}
					{onOverlay}
					onMove={(axisId) => onMove(view.key, axisId)}
					onMoveToNewAxis={() => onMoveToNewAxis(view.key)}
				/>
			{/each}
		</div>
	{/if}
</div>
