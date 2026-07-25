<script lang="ts">
	import type { PlotRatioPoint } from '$lib/plot-geometry.js';
	import {
		boxViewport,
		dataPointAtRatio,
		panViewport,
		type PlotPoint,
		type PlotViewport
	} from '$lib/plot-viewport.js';
	import { PlotViewportState } from '$lib/plot-viewport-state.svelte.js';
	import { plotDragMode } from '$lib/plot-interaction-policy.js';

	let {
		viewport,
		boxZoomEnabled,
		suspended,
		grid,
		onContextMenuPoint
	}: {
		viewport: PlotViewportState;
		boxZoomEnabled: boolean;
		suspended: boolean;
		grid: { left: number; right: number; top: number; bottom: number };
		onContextMenuPoint?: (point: PlotPoint | null) => void;
	} = $props();

	let overlay: HTMLButtonElement;
	let dragState = $state<DragState | null>(null);

	type DragState =
		| {
				type: 'pan';
				pointerId: number;
				clientX: number;
				clientY: number;
				startViewport: PlotViewport;
		  }
		| {
				type: 'box';
				pointerId: number;
				start: PlotRatioPoint;
				current: PlotRatioPoint;
		  };

	$effect(() => {
		if (suspended) cancelPlotDrag();
	});

	function handleContextMenu(event: MouseEvent) {
		if (suspended) return;
		onContextMenuPoint?.(clientToDataPoint(event));
	}

	function startPlotDrag(event: PointerEvent) {
		if (suspended) return;
		const activeViewport = viewport.activeViewport;
		const mode = plotDragMode(event.button, boxZoomEnabled);
		if (activeViewport === null || event.button !== 0 || mode === null) return;
		const point = currentPlotRatio(event);
		if (point === null) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

		dragState =
			mode === 'box'
				? { type: 'box', pointerId: event.pointerId, start: point, current: point }
				: {
						type: 'pan',
						pointerId: event.pointerId,
						clientX: event.clientX,
						clientY: event.clientY,
						startViewport: activeViewport
					};
	}

	function dragPlot(event: PointerEvent) {
		if (dragState === null || dragState.pointerId !== event.pointerId) return;
		if (suspended) {
			cancelPlotDrag();
			return;
		}
		event.preventDefault();

		if (dragState.type === 'box') {
			const point = currentPlotRatio(event);
			if (point !== null) dragState = { ...dragState, current: point };
			return;
		}

		viewport.setManual(
			panViewport(
				dragState.startViewport,
				{
					x: event.clientX - dragState.clientX,
					y: event.clientY - dragState.clientY
				},
				currentPlotSize()
			)
		);
	}

	function stopPlotDrag(event: PointerEvent) {
		if (dragState === null || dragState.pointerId !== event.pointerId) return;
		if (suspended) {
			cancelPlotDrag();
			return;
		}
		const state = dragState;
		dragState = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);

		const activeViewport = viewport.activeViewport;
		if (state.type === 'box' && activeViewport !== null) {
			const nextViewport = boxViewport(activeViewport, state.start, state.current);
			if (nextViewport !== null) viewport.setManual(nextViewport);
		}
	}

	function cancelBoxZoom(event: KeyboardEvent) {
		if (event.key !== 'Escape' || dragState?.type !== 'box') return;
		event.preventDefault();
		event.stopImmediatePropagation();
		cancelPlotDrag();
	}

	function cancelPlotDrag() {
		const pointerId = dragState?.pointerId;
		dragState = null;
		if (pointerId !== undefined && overlay?.hasPointerCapture(pointerId)) {
			overlay.releasePointerCapture(pointerId);
		}
	}

	function clientToDataPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): PlotPoint | null {
		const activeViewport = viewport.activeViewport;
		if (activeViewport === null) return null;
		const point = currentPlotRatio(event);
		if (point === null) return null;
		return dataPointAtRatio(activeViewport, point);
	}

	function currentPlotRatio(
		event: Pick<PointerEvent, 'clientX' | 'clientY'>
	): PlotRatioPoint | null {
		const rect = overlay.getBoundingClientRect();
		const size = currentPlotSize();
		if (!(size.width > 0) || !(size.height > 0)) return null;

		return {
			xRatio: clamp((event.clientX - rect.left - grid.left) / size.width, 0, 1),
			yRatio: clamp((event.clientY - rect.top - grid.top) / size.height, 0, 1)
		};
	}

	function currentPlotSize(): { width: number; height: number } {
		const rect = overlay.getBoundingClientRect();
		return {
			width: rect.width - grid.left - grid.right,
			height: rect.height - grid.top - grid.bottom
		};
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}
</script>

<svelte:window onkeydowncapture={cancelBoxZoom} />

<button
	bind:this={overlay}
	type="button"
	data-export-ignore
	class={`absolute z-30 border-0 bg-transparent p-0 text-left outline-none ${
		boxZoomEnabled
			? 'cursor-crosshair'
			: dragState?.type === 'pan'
				? 'cursor-grabbing'
				: 'cursor-grab'
	}`}
	style:inset="0"
	aria-label="Plot viewport interaction"
	data-plot-wheel-target
	oncontextmenu={handleContextMenu}
	onpointerdown={startPlotDrag}
	onpointermove={dragPlot}
	onpointerup={stopPlotDrag}
	onpointercancel={stopPlotDrag}
	onkeydown={cancelBoxZoom}
>
	{#if dragState?.type === 'box'}
		<div
			class="pointer-events-none absolute"
			style:top={`${grid.top}px`}
			style:bottom={`${grid.bottom}px`}
			style:left={`${grid.left}px`}
			style:right={`${grid.right}px`}
		>
			<div
				class="absolute border border-current bg-current/10 text-foreground"
				style:left={`${Math.min(dragState.start.xRatio, dragState.current.xRatio) * 100}%`}
				style:top={`${Math.min(dragState.start.yRatio, dragState.current.yRatio) * 100}%`}
				style:width={`${Math.abs(dragState.current.xRatio - dragState.start.xRatio) * 100}%`}
				style:height={`${Math.abs(dragState.current.yRatio - dragState.start.yRatio) * 100}%`}
			></div>
		</div>
	{/if}
</button>
