import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { useStore } from 'zustand';
import { normalizedWheelDelta, type PlotRatioPoint } from '#lib/plot-geometry.js';
import { plotDragMode, plotWheelAction } from '#lib/plot-interaction-policy.js';
import { plotAreaRect, ratioInArea } from '#lib/plot-pointer.js';
import {
	boxViewport,
	dataPointAtRatio,
	panViewport,
	type PlotPoint,
	type PlotViewport
} from '#lib/plot-viewport.js';
import { plotModel } from '#lib/stores/plot-model.js';
import { panBy, plotView, setPointerRatio, setViewport, zoomBy } from '#lib/stores/plot-view.js';

const WHEEL_ZOOM_SPEED = 0.002;

type DragState = {
	pointerId: number;
	captureTarget: HTMLElement;
} & (
	| { type: 'pan'; clientX: number; clientY: number; startViewport: PlotViewport }
	| { type: 'box'; start: PlotRatioPoint; current: PlotRatioPoint }
);

/**
 * Pan, wheel zoom and box zoom over the plot. Gestures write the viewport store directly and
 * draw the box and grab cursor through the DOM, so pointer movement never re-renders React.
 */
export function PlotInteraction({
	eventRoot,
	plotSurface,
	onContextMenuPoint
}: {
	eventRoot: RefObject<HTMLElement | null>;
	plotSurface: RefObject<HTMLElement | null>;
	onContextMenuPoint: (point: PlotPoint | null) => void;
}) {
	const boxZoomEnabled = useStore(plotView, (state) => state.boxZoomEnabled);
	const grid = useStore(plotModel, (state) => state.grid);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const root = eventRoot.current;
		const surface = plotSurface.current;
		const button = buttonRef.current;
		const box = boxRef.current;
		if (root === null || surface === null || button === null || box === null) return;
		return wireGestures(root, surface, button, box);
	}, [eventRoot, plotSurface]);

	function rememberContextMenuPoint(event: MouseEvent) {
		const surface = plotSurface.current;
		const { activeViewport, legendSelectOpen } = plotView.getState();
		if (legendSelectOpen || surface === null) return;
		const point = ratioInArea(plotAreaRect(surface, grid), event);
		onContextMenuPoint(
			activeViewport === null || point === null ? null : dataPointAtRatio(activeViewport, point)
		);
	}

	return (
		<button
			ref={buttonRef}
			type="button"
			data-export-ignore
			className={`absolute inset-0 z-30 border-0 bg-transparent p-0 text-left outline-none ${
				boxZoomEnabled ? 'cursor-crosshair' : 'cursor-grab data-panning:cursor-grabbing'
			}`}
			aria-label="Plot viewport interaction"
			data-plot-wheel-target
			onContextMenu={rememberContextMenuPoint}
		>
			<div
				className="pointer-events-none absolute"
				style={{ top: grid.top, bottom: grid.bottom, left: grid.left, right: grid.right }}
			>
				<div
					ref={boxRef}
					className="absolute border border-current bg-current/10 text-foreground"
					style={{ display: 'none' }}
				/>
			</div>
		</button>
	);
}

/** Attach the plot gesture listeners; returns their cleanup. */
function wireGestures(
	root: HTMLElement,
	surface: HTMLElement,
	button: HTMLButtonElement,
	box: HTMLDivElement
): () => void {
	let drag: DragState | null = null;
	const suspended = () => plotView.getState().legendSelectOpen;
	const area = () => plotAreaRect(surface, plotModel.getState().grid);
	const isPlotTarget = (target: EventTarget | null) =>
		target instanceof Element &&
		(surface.contains(target) || target.closest('[data-plot-wheel-target]') !== null);

	function startDrag(event: PointerEvent, type: 'pan' | 'box') {
		const startViewport = plotView.getState().activeViewport;
		const point = ratioInArea(area(), event);
		if (startViewport === null || point === null) return;
		event.preventDefault();
		const captureTarget = event.currentTarget as HTMLElement;
		captureTarget.setPointerCapture(event.pointerId);
		const base = { pointerId: event.pointerId, captureTarget };
		drag =
			type === 'box'
				? { ...base, type, start: point, current: point }
				: { ...base, type, clientX: event.clientX, clientY: event.clientY, startViewport };
		if (type === 'pan') button.dataset.panning = '';
		else drawBox(point, point);
	}

	function startButtonDrag(event: PointerEvent) {
		const mode = plotDragMode(event.button, plotView.getState().boxZoomEnabled);
		if (!suspended() && event.button === 0 && mode !== null) startDrag(event, mode);
	}

	function startMiddleDrag(event: PointerEvent) {
		if (
			suspended() ||
			event.button !== 1 ||
			plotDragMode(event.button, plotView.getState().boxZoomEnabled) !== 'pan' ||
			plotView.getState().activeViewport === null ||
			!isPlotTarget(event.target)
		) {
			return;
		}
		event.stopPropagation();
		startDrag(event, 'pan');
	}

	function ownsDrag(event: PointerEvent): DragState | null {
		if (drag?.pointerId !== event.pointerId || drag.captureTarget !== event.currentTarget) {
			return null;
		}
		if (suspended()) {
			cancelDrag();
			return null;
		}
		return drag;
	}

	function moveDrag(event: PointerEvent) {
		const state = ownsDrag(event);
		if (state === null) return;
		event.preventDefault();
		if (state.type === 'box') {
			const point = ratioInArea(area(), event);
			if (point === null) return;
			state.current = point;
			drawBox(state.start, point);
			return;
		}
		const delta = { x: event.clientX - state.clientX, y: event.clientY - state.clientY };
		setViewport(panViewport(state.startViewport, delta, area()));
	}

	function stopDrag(event: PointerEvent) {
		const state = ownsDrag(event);
		if (state === null) return;
		cancelDrag();
		const viewport = plotView.getState().activeViewport;
		if (state.type !== 'box' || viewport === null) return;
		const next = boxViewport(viewport, state.start, state.current);
		if (next !== null) setViewport(next);
	}

	function cancelDrag() {
		const state = drag;
		drag = null;
		delete button.dataset.panning;
		box.style.display = 'none';
		if (state?.captureTarget.hasPointerCapture(state.pointerId)) {
			state.captureTarget.releasePointerCapture(state.pointerId);
		}
	}

	function drawBox(start: PlotRatioPoint, end: PlotRatioPoint) {
		Object.assign(box.style, {
			display: '',
			left: `${Math.min(start.xRatio, end.xRatio) * 100}%`,
			top: `${Math.min(start.yRatio, end.yRatio) * 100}%`,
			width: `${Math.abs(end.xRatio - start.xRatio) * 100}%`,
			height: `${Math.abs(end.yRatio - start.yRatio) * 100}%`
		});
	}

	function cancelBoxZoom(event: KeyboardEvent) {
		if (event.key !== 'Escape' || drag?.type !== 'box') return;
		event.preventDefault();
		event.stopImmediatePropagation();
		cancelDrag();
	}

	function wheel(event: WheelEvent) {
		if (suspended() || plotView.getState().activeViewport === null) return;
		if (!isPlotTarget(event.target)) return;
		const plotArea = area();
		const point = ratioInArea(plotArea, event);
		if (point === null) return;
		const delta = normalizedWheelDelta(event, plotArea.height);
		const action = plotWheelAction(delta, { shift: event.shiftKey, alt: event.altKey });
		if (action === null) return;

		event.preventDefault();
		if (action.type === 'pan-x') {
			panBy({ x: action.deltaX, y: 0 }, plotArea);
			return;
		}
		const factor = Math.exp(Math.min(200, Math.max(-200, action.delta)) * WHEEL_ZOOM_SPEED);
		zoomBy(factor, point, action.axes);
	}

	function trackPointer(event: PointerEvent) {
		setPointerRatio(!suspended() && isPlotTarget(event.target) ? ratioInArea(area(), event) : null);
	}

	function preventMiddleAutoscroll(event: globalThis.MouseEvent) {
		if (event.button === 1 && isPlotTarget(event.target)) event.preventDefault();
	}

	const clearPointer = () => setPointerRatio(null);
	const controller = new AbortController();
	const options = { signal: controller.signal };
	root.addEventListener('wheel', wheel, { passive: false, signal: controller.signal });
	root.addEventListener('pointerdown', startMiddleDrag, { ...options, capture: true });
	root.addEventListener('pointermove', trackPointer, { ...options, capture: true });
	root.addEventListener('auxclick', preventMiddleAutoscroll, options);
	root.addEventListener('pointerleave', clearPointer, options);
	button.addEventListener('pointerdown', startButtonDrag, options);
	for (const target of [root, button]) {
		target.addEventListener('pointermove', moveDrag, options);
		target.addEventListener('pointerup', stopDrag, options);
		target.addEventListener('pointercancel', stopDrag, options);
	}
	window.addEventListener('keydown', cancelBoxZoom, { ...options, capture: true });
	const unsubscribe = plotView.subscribe(
		(state) => state.legendSelectOpen,
		(open) => {
			if (!open) return;
			cancelDrag();
			clearPointer();
		}
	);

	return () => {
		controller.abort();
		unsubscribe();
		cancelDrag();
		clearPointer();
	};
}
