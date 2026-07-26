<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { YAxisId } from '$lib/plot-axes.js';
	import type { LegendSignalValue, SignalView } from '$lib/signal-plot-data.js';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import PlusIcon from '@lucide/svelte/icons/plus';

	let {
		view,
		value,
		showValue,
		axisTargets,
		currentAxisId,
		canAddAxis,
		draggable,
		onMove,
		onMoveToNewAxis,
		onOverlay
	}: {
		view: SignalView;
		value: LegendSignalValue | undefined;
		showValue: boolean;
		axisTargets: { id: YAxisId; label: string }[];
		currentAxisId: YAxisId;
		canAddAxis: boolean;
		draggable: boolean;
		onMove: (axisId: YAxisId) => void;
		onMoveToNewAxis: () => void;
		onOverlay: (open: boolean) => void;
	} = $props();

	let menuOpen = $state(false);

	// The grip doubles as the accessible path: dragging is a pointer-only
	// affordance, so the same control opens a move menu on click or Enter.
	const menuAvailable = $derived(axisTargets.length > 1 || canAddAxis);

	function handleOpen(open: boolean): void {
		menuOpen = open;
		onOverlay(open);
	}

	function select(action: () => void): void {
		handleOpen(false);
		action();
	}

	function startDrag(event: DragEvent): void {
		if (!draggable || event.dataTransfer === null) return;
		event.dataTransfer.setData('text/plain', view.key);
		event.dataTransfer.effectAllowed = 'move';
	}
</script>

<div
	class="grid min-w-0 items-center gap-2 rounded-sm text-xs"
	class:grid-cols-[1.25rem_0.75rem_minmax(0,1fr)_auto]={menuAvailable && showValue}
	class:grid-cols-[1.25rem_0.75rem_minmax(0,1fr)]={menuAvailable && !showValue}
	class:grid-cols-[0.75rem_minmax(0,1fr)_auto]={!menuAvailable && showValue}
	class:grid-cols-[0.75rem_minmax(0,1fr)]={!menuAvailable && !showValue}
	role="listitem"
	draggable={draggable ? 'true' : 'false'}
	ondragstart={startDrag}
>
	{#if menuAvailable}
		<Popover.Root bind:open={() => menuOpen, handleOpen}>
			<Popover.Trigger
				class={cn(
					buttonVariants({ variant: 'ghost', size: 'icon' }),
					'size-5 text-muted-foreground hover:text-foreground',
					draggable && 'cursor-grab active:cursor-grabbing'
				)}
				aria-label={`Move ${view.label} to another Y axis`}
			>
				<GripVerticalIcon class="size-3.5" />
			</Popover.Trigger>
			<Popover.Content align="start" class="w-48 gap-1 p-1.5">
				<div class="px-2 py-1 text-xs font-medium text-muted-foreground">Move to</div>
				{#each axisTargets as target (target.id)}
					<button
						type="button"
						class={cn(
							buttonVariants({ variant: 'ghost', size: 'sm' }),
							'w-full justify-start font-normal'
						)}
						disabled={target.id === currentAxisId}
						onclick={() => select(() => onMove(target.id))}
					>
						{target.label}
					</button>
				{/each}
				{#if canAddAxis}
					<button
						type="button"
						class={cn(
							buttonVariants({ variant: 'ghost', size: 'sm' }),
							'w-full justify-start font-normal'
						)}
						onclick={() => select(onMoveToNewAxis)}
					>
						<PlusIcon />
						New Y axis
					</button>
				{/if}
			</Popover.Content>
		</Popover.Root>
	{/if}

	<span class="size-2 rounded-full" style:background-color={view.color}></span>
	<span class="flex min-w-0" title={view.label}>
		<span class="min-w-0 flex-[0_1_max-content] truncate">{view.signalName}</span>
		<span class="text-muted-foreground">&nbsp;(</span>
		<span class="min-w-0 flex-[0_9999_auto] truncate text-muted-foreground">
			{view.messageName}
		</span>
		<span class="text-muted-foreground">)</span>
	</span>
	{#if showValue}
		<span
			class="font-mono tabular-nums"
			class:text-destructive={value?.outOfRange}
			title={value?.outOfRange ? `Outside DBC range [${view.minimum}, ${view.maximum}]` : undefined}
		>
			{value?.text ?? '-'}
		</span>
	{/if}
</div>
