<script lang="ts">
	import { normalizedWheelDelta, type PlotRatioPoint } from '$lib/plot-geometry.js';
	import {
		boxViewport,
		dataPointAtRatio,
		panViewport,
		type PlotPoint,
		type PlotViewport
	} from '$lib/plot-viewport.js';
	import { PlotViewportState } from '$lib/plot-viewport-state.svelte.js';
	import { plotDragMode, plotWheelAction } from '$lib/plot-interaction-policy.js';

	let {
		viewport,
		boxZoomEnabled,
		suspended,
		grid,
		eventRoot,
		plotSurface,
		pointerRatio = $bindable(null), // eslint-disable-line no-useless-assignment
		onContextMenuPoint
	}: {
		viewport: PlotViewportState;
		boxZoomEnabled: boolean;
		suspended: boolean;
		grid: { left: number; right: number; top: number; bottom: number };
		eventRoot?: HTMLElement | null;
		plotSurface?: HTMLElement | null;
		pointerRatio?: PlotRatioPoint | null;
		onContextMenuPoint?: (point: PlotPoint | null) => void;
	} = $props();

	let dragState = $state<DragState | null>(null);

	const WHEEL_ZOOM_SPEED = 0.002;

	type DragState =
		| {
				type: 'pan';
				pointerId: number;
				clientX: number;
				clientY: number;
				startViewport: PlotViewport;
				captureTarget: HTMLElement;
		  }
		| {
				type: 'box';
				pointerId: number;
				start: PlotRatioPoint;
				current: PlotRatioPoint;
				captureTarget: HTMLElement;
		  };

	$effect(() => {
		if (suspended) {
			cancelPlotDrag();
			pointerRatio = null;
		}
	});

	$effect(() => {
		const root = eventRoot;
		if (root == null) return;

		const controller = new AbortController();
		const { signal } = controller;
		root.addEventListener('wheel', handlePlotWheel, { passive: false, signal });
		root.addEventListener('pointerdown', startMiddleDrag, { capture: true, signal });
		root.addEventListener('pointermove', trackPlotPointer, { capture: true, signal });
		root.addEventListener('pointermove', dragPlot, { signal });
		root.addEventListener('pointerup', stopPlotDrag, { signal });
		root.addEventListener('pointercancel', stopPlotDrag, { signal });
		root.addEventListener('auxclick', preventMiddleAutoscroll, { signal });
		root.addEventListener('pointerleave', clearPointerRatio, { signal });

		return () => {
			controller.abort();
			cancelPlotDrag();
			pointerRatio = null;
		};
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

		startDrag(event, activeViewport, mode, point);
	}

	function startDrag(
		event: PointerEvent,
		activeViewport: PlotViewport,
		mode: 'pan' | 'box',
		point: PlotRatioPoint
	): void {
		event.preventDefault();
		const captureTarget = event.currentTarget as HTMLElement;
		captureTarget.setPointerCapture(event.pointerId);
		dragState =
			mode === 'box'
				? {
						type: 'box',
						pointerId: event.pointerId,
						start: point,
						current: point,
						captureTarget
					}
				: {
						type: 'pan',
						pointerId: event.pointerId,
						clientX: event.clientX,
						clientY: event.clientY,
						startViewport: activeViewport,
						captureTarget
					};
	}

	function dragPlot(event: PointerEvent) {
		if (
			dragState === null ||
			dragState.pointerId !== event.pointerId ||
			dragState.captureTarget !== event.currentTarget
		) {
			return;
		}
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
		if (
			dragState === null ||
			dragState.pointerId !== event.pointerId ||
			dragState.captureTarget !== event.currentTarget
		) {
			return;
		}
		if (suspended) {
			cancelPlotDrag();
			return;
		}
		const state = dragState;
		cancelPlotDrag();

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
		const state = dragState;
		dragState = null;
		if (state?.captureTarget.hasPointerCapture(state.pointerId)) {
			state.captureTarget.releasePointerCapture(state.pointerId);
		}
	}

	function handlePlotWheel(event: WheelEvent) {
		if (suspended || viewport.activeViewport === null || !isPlotInteractionTarget(event.target))
			return;
		const point = currentPlotRatio(event);
		if (point === null) return;

		const plotSize = currentPlotSize();
		const delta = normalizedWheelDelta(event, plotSize.height);
		const action = plotWheelAction(delta, { shift: event.shiftKey, alt: event.altKey });
		if (action === null) return;

		event.preventDefault();
		if (action.type === 'pan-x') {
			viewport.panBy({ x: action.deltaX, y: 0 }, plotSize);
			return;
		}

		const factor = Math.exp(Math.min(200, Math.max(-200, action.delta)) * WHEEL_ZOOM_SPEED);
		viewport.zoomBy(factor, point, action.axes);
	}

	function startMiddleDrag(event: PointerEvent): void {
		const activeViewport = viewport.activeViewport;
		if (
			suspended ||
			event.button !== 1 ||
			plotDragMode(event.button, boxZoomEnabled) !== 'pan' ||
			activeViewport === null ||
			!isPlotInteractionTarget(event.target)
		) {
			return;
		}

		event.stopPropagation();
		const point = currentPlotRatio(event);
		if (point !== null) startDrag(event, activeViewport, 'pan', point);
	}

	function preventMiddleAutoscroll(event: MouseEvent): void {
		if (event.button === 1 && isPlotInteractionTarget(event.target)) event.preventDefault();
	}

	function trackPlotPointer(event: PointerEvent): void {
		pointerRatio =
			!suspended && isPlotInteractionTarget(event.target) ? currentPlotRatio(event) : null;
	}

	function clearPointerRatio(): void {
		pointerRatio = null;
	}

	function isPlotInteractionTarget(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			(plotSurface?.contains(target) === true ||
				target.closest('[data-plot-wheel-target]') !== null)
		);
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
		const rect = plotSurface?.getBoundingClientRect();
		if (rect === undefined) return null;
		const size = currentPlotSize();
		if (!(size.width > 0) || !(size.height > 0)) return null;

		return {
			xRatio: clamp((event.clientX - rect.left - grid.left) / size.width, 0, 1),
			yRatio: clamp((event.clientY - rect.top - grid.top) / size.height, 0, 1)
		};
	}

	function currentPlotSize(): { width: number; height: number } {
		const rect = plotSurface?.getBoundingClientRect();
		if (rect === undefined) return { width: 0, height: 0 };
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
