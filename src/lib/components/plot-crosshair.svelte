<script lang="ts">
	import {
		moveCrosshair,
		type CrosshairDragAxis,
		type PlotCrosshair
	} from '$lib/plot-crosshair.js';
	import {
		dataPointAtRatio,
		ratioAtDataPoint,
		type PlotPoint,
		type PlotViewport
	} from '$lib/plot-viewport.js';
	import { onDestroy } from 'svelte';

	let {
		crosshair,
		viewport,
		grid,
		onCrosshair,
		onContextMenuPoint
	}: {
		crosshair: PlotCrosshair;
		viewport: PlotViewport | null;
		grid: { left: number; right: number; top: number; bottom: number };
		onCrosshair: (crosshair: PlotCrosshair) => void;
		onContextMenuPoint?: (point: PlotPoint | null, crosshair: PlotCrosshair) => void;
	} = $props();

	let track: HTMLDivElement;
	let dragState = $state<{ pointerId: number; axis: CrosshairDragAxis } | null>(null);
	let dragRaf: number | null = null;
	let pendingCrosshair: PlotCrosshair | null = null;

	const ratio = $derived(viewport === null ? null : ratioAtDataPoint(viewport, crosshair));
	const xPercent = $derived(
		ratio !== null && ratio.xRatio >= 0 && ratio.xRatio <= 1 ? ratio.xRatio * 100 : null
	);
	const yPercent = $derived(
		ratio !== null && ratio.yRatio >= 0 && ratio.yRatio <= 1 ? ratio.yRatio * 100 : null
	);

	onDestroy(cancelDragUpdate);

	function startDrag(axis: CrosshairDragAxis, event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		dragState = { pointerId: event.pointerId, axis };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		updateFromPointer(event);
	}

	function drag(event: PointerEvent) {
		if (dragState?.pointerId !== event.pointerId) return;
		event.preventDefault();
		updateFromPointer(event);
	}

	function stopDrag(event: PointerEvent) {
		if (dragState?.pointerId !== event.pointerId) return;
		dragState = null;
		flushPendingUpdate();
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function updateFromPointer(event: PointerEvent) {
		const point = clientToDataPoint(event);
		if (point === null || dragState === null) return;

		pendingCrosshair = moveCrosshair(crosshair, point, dragState.axis);
		if (dragRaf !== null) return;

		dragRaf = requestAnimationFrame(() => {
			dragRaf = null;
			if (pendingCrosshair === null) return;
			onCrosshair(pendingCrosshair);
			pendingCrosshair = null;
		});
	}

	function rememberContextMenuPoint(event: MouseEvent) {
		onContextMenuPoint?.(clientToDataPoint(event), crosshair);
	}

	function clientToDataPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): PlotPoint | null {
		if (viewport === null) return null;
		const rect = track.getBoundingClientRect();
		if (!(rect.width > 0) || !(rect.height > 0)) return null;
		return dataPointAtRatio(viewport, {
			xRatio: (event.clientX - rect.left) / rect.width,
			yRatio: (event.clientY - rect.top) / rect.height
		});
	}

	function cancelDragUpdate() {
		if (dragRaf !== null) {
			cancelAnimationFrame(dragRaf);
			dragRaf = null;
		}
		pendingCrosshair = null;
	}

	function flushPendingUpdate() {
		if (dragRaf !== null) {
			cancelAnimationFrame(dragRaf);
			dragRaf = null;
		}
		if (pendingCrosshair !== null) {
			onCrosshair(pendingCrosshair);
			pendingCrosshair = null;
		}
	}
</script>

<div
	bind:this={track}
	class={[
		'pointer-events-none absolute z-40',
		crosshair.id === 1 ? 'text-sky-500' : 'text-amber-500'
	]}
	style:top={`${grid.top}px`}
	style:bottom={`${grid.bottom}px`}
	style:left={`${grid.left}px`}
	style:right={`${grid.right}px`}
>
	{#if xPercent !== null}
		<button
			type="button"
			class="pointer-events-auto absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize border-0 bg-transparent p-0"
			style:left={`${xPercent}%`}
			aria-label={`Crosshair ${crosshair.id} X position`}
			data-plot-wheel-target
			oncontextmenu={rememberContextMenuPoint}
			onpointerdown={(event) => startDrag('x', event)}
			onpointermove={drag}
			onpointerup={stopDrag}
			onpointercancel={stopDrag}
		>
			<span class="absolute inset-y-0 left-1/2 border-l border-current"></span>
		</button>
	{/if}

	{#if yPercent !== null}
		<button
			type="button"
			class="pointer-events-auto absolute inset-x-0 h-5 -translate-y-1/2 cursor-ns-resize border-0 bg-transparent p-0"
			style:top={`${yPercent}%`}
			aria-label={`Crosshair ${crosshair.id} Y position`}
			data-plot-wheel-target
			oncontextmenu={rememberContextMenuPoint}
			onpointerdown={(event) => startDrag('y', event)}
			onpointermove={drag}
			onpointerup={stopDrag}
			onpointercancel={stopDrag}
		>
			<span class="absolute inset-x-0 top-1/2 border-t border-current"></span>
		</button>
	{/if}

	{#if xPercent !== null && yPercent !== null}
		<button
			type="button"
			class="pointer-events-auto absolute z-10 size-6 -translate-1/2 cursor-move border-0 bg-transparent p-0"
			style:left={`${xPercent}%`}
			style:top={`${yPercent}%`}
			aria-label={`Move crosshair ${crosshair.id}`}
			data-plot-wheel-target
			oncontextmenu={rememberContextMenuPoint}
			onpointerdown={(event) => startDrag('both', event)}
			onpointermove={drag}
			onpointerup={stopDrag}
			onpointercancel={stopDrag}
		>
			<span
				class="absolute top-1/2 left-1/2 size-3 -translate-1/2 rounded-full border-2 border-current bg-background"
			></span>
			<span
				class={[
					'absolute top-full left-full -mt-1 -ml-1 rounded-sm px-1 font-mono text-[0.625rem] leading-4 font-semibold shadow-sm',
					crosshair.id === 1 ? 'bg-sky-500 text-white' : 'bg-amber-500 text-black'
				]}
			>
				{crosshair.id}
			</span>
		</button>
	{/if}
</div>
