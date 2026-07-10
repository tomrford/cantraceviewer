<script lang="ts">
	import type { PlotViewport } from '$lib/plot-viewport.js';
	import { onDestroy } from 'svelte';

	let {
		viewport,
		grid,
		percent,
		onMarkerX,
		onContextMenuPoint
	}: {
		viewport: PlotViewport | null;
		grid: { left: number; right: number; top: number; bottom: number };
		percent: number;
		onMarkerX: (x: number) => void;
		onContextMenuPoint?: (x: number | null) => void;
	} = $props();

	let track: HTMLDivElement;
	let markerDragPointerId = $state<number | null>(null);
	let markerDragRaf: number | null = null;
	let pendingMarkerX: number | null = null;

	onDestroy(cancelMarkerDragUpdate);

	function startMarkerDrag(event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		markerDragPointerId = event.pointerId;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		updateMarkerFromPointer(event);
	}

	function dragMarker(event: PointerEvent) {
		if (markerDragPointerId !== event.pointerId) return;
		event.preventDefault();
		updateMarkerFromPointer(event);
	}

	function stopMarkerDrag(event: PointerEvent) {
		if (markerDragPointerId !== event.pointerId) return;
		markerDragPointerId = null;
		flushPendingMarkerUpdate();
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function updateMarkerFromPointer(event: PointerEvent) {
		const x = clientToDataX(event);
		if (x === null) return;

		pendingMarkerX = x;
		if (markerDragRaf !== null) return;

		markerDragRaf = requestAnimationFrame(() => {
			markerDragRaf = null;
			if (pendingMarkerX === null) return;
			onMarkerX(pendingMarkerX);
			pendingMarkerX = null;
		});
	}

	function cancelMarkerDragUpdate() {
		if (markerDragRaf !== null) {
			cancelAnimationFrame(markerDragRaf);
			markerDragRaf = null;
		}
		pendingMarkerX = null;
	}

	function flushPendingMarkerUpdate() {
		if (markerDragRaf !== null) {
			cancelAnimationFrame(markerDragRaf);
			markerDragRaf = null;
		}

		if (pendingMarkerX !== null) {
			onMarkerX(pendingMarkerX);
			pendingMarkerX = null;
		}
	}

	function clientToDataX(event: Pick<MouseEvent, 'clientX'>): number | null {
		if (viewport === null) return null;
		const rect = track.getBoundingClientRect();
		if (!(rect.width > 0) || !(rect.height > 0)) return null;
		const xRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		return viewport.xMin + xRatio * (viewport.xMax - viewport.xMin);
	}
</script>

<div
	bind:this={track}
	class="pointer-events-none absolute z-40 text-foreground"
	style:top={`${grid.top}px`}
	style:bottom={`${grid.bottom}px`}
	style:left={`${grid.left}px`}
	style:right={`${grid.right}px`}
>
	<div
		class="pointer-events-auto absolute inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize"
		style:left={`${percent}%`}
		role="separator"
		aria-label="X marker"
		aria-orientation="vertical"
		data-plot-wheel-target
		tabindex="-1"
		oncontextmenu={(event) => onContextMenuPoint?.(clientToDataX(event))}
		onpointerdown={startMarkerDrag}
		onpointermove={dragMarker}
		onpointerup={stopMarkerDrag}
		onpointercancel={stopMarkerDrag}
	>
		<span class="absolute inset-y-0 left-1/2 border-l border-current"></span>
	</div>
</div>
