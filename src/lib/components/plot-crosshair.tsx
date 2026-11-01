import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import { useStore } from 'zustand';
import {
	crosshairById,
	moveCrosshair,
	type CrosshairDragAxis,
	type CrosshairId,
	type PlotCrosshair
} from '#lib/plot-crosshair.js';
import { ratioInArea } from '#lib/plot-pointer.js';
import { dataPointAtRatio, ratioAtDataPoint, type PlotPoint } from '#lib/plot-viewport.js';
import { plotModel } from '#lib/stores/plot-model.js';
import { plotView, upsertCrosshair } from '#lib/stores/plot-view.js';

type Gesture = {
	drag: { pointerId: number; axis: CrosshairDragAxis; target: HTMLElement } | null;
	frame: number | null;
	pending: PlotCrosshair | null;
};

const HANDLES = [
	{
		axis: 'x',
		label: 'X position',
		className: 'inset-y-0 w-5 -translate-x-1/2 cursor-ew-resize',
		line: 'inset-y-0 left-1/2 border-l'
	},
	{
		axis: 'y',
		label: 'Y position',
		className: 'inset-x-0 h-5 -translate-y-1/2 cursor-ns-resize',
		line: 'inset-x-0 top-1/2 border-t'
	}
] as const;

/** Lines and drag handles for one crosshair; renders nothing while it is not placed. */
export function PlotCrosshairOverlay({
	id,
	onContextMenuPoint
}: {
	id: CrosshairId;
	onContextMenuPoint: (point: PlotPoint | null, id: CrosshairId) => void;
}) {
	const crosshair = useStore(plotView, (state) => crosshairById(state.crosshairs, id));
	const viewport = useStore(plotView, (state) => state.activeViewport);
	const grid = useStore(plotModel, (state) => state.grid);
	const track = useRef<HTMLDivElement>(null);
	const gesture = useRef<Gesture>({ drag: null, frame: null, pending: null });

	// Drop an in-flight drag when the crosshair is removed (C key, Clear all, WebMCP), so a pending
	// frame cannot re-create it.
	useEffect(() => {
		const current = gesture.current;
		const unsubscribe = plotView.subscribe(
			(state) => crosshairById(state.crosshairs, id) === null,
			(removed) => removed && cancelGesture(current)
		);
		return () => {
			unsubscribe();
			cancelGesture(current);
		};
	}, [id]);

	function pointAt(event: { clientX: number; clientY: number }): PlotPoint | null {
		const activeViewport = plotView.getState().activeViewport;
		const rect = track.current?.getBoundingClientRect();
		const point = rect === undefined ? null : ratioInArea(rect, event);
		return activeViewport === null || point === null
			? null
			: dataPointAtRatio(activeViewport, point);
	}

	function startDrag(axis: CrosshairDragAxis, event: PointerEvent<HTMLElement>) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		gesture.current.drag = { pointerId: event.pointerId, axis, target };
		target.setPointerCapture(event.pointerId);
		updateFromPointer(event);
	}

	function moveDrag(event: PointerEvent) {
		if (gesture.current.drag?.pointerId !== event.pointerId) return;
		event.preventDefault();
		updateFromPointer(event);
	}

	function stopDrag(event: PointerEvent) {
		if (gesture.current.drag?.pointerId !== event.pointerId) return;
		flushGesture(gesture.current);
		cancelGesture(gesture.current);
	}

	// Coalesce drag updates to one store write per frame.
	function updateFromPointer(event: PointerEvent) {
		const state = gesture.current;
		const current = crosshairById(plotView.getState().crosshairs, id);
		const point = pointAt(event);
		if (current === null || point === null || state.drag === null) return;
		state.pending = moveCrosshair(state.pending ?? current, point, state.drag.axis);
		if (state.frame === null) state.frame = requestAnimationFrame(() => flushGesture(state));
	}

	function rememberContextMenuPoint(event: MouseEvent) {
		onContextMenuPoint(pointAt(event), id);
	}

	if (crosshair === null || viewport === null) return null;
	const ratio = ratioAtDataPoint(viewport, crosshair);
	const percent = {
		x: ratio.xRatio >= 0 && ratio.xRatio <= 1 ? `${ratio.xRatio * 100}%` : null,
		y: ratio.yRatio >= 0 && ratio.yRatio <= 1 ? `${ratio.yRatio * 100}%` : null
	};
	const handlers = {
		onContextMenu: rememberContextMenuPoint,
		onPointerMove: moveDrag,
		onPointerUp: stopDrag,
		onPointerCancel: stopDrag
	};

	return (
		<div
			ref={track}
			className="pointer-events-none absolute z-40 text-foreground"
			style={{ top: grid.top, bottom: grid.bottom, left: grid.left, right: grid.right }}
		>
			{HANDLES.map((handle) => {
				const position = percent[handle.axis];
				if (position === null) return null;
				return (
					<button
						key={handle.axis}
						type="button"
						className={`pointer-events-auto absolute border-0 bg-transparent p-0 ${handle.className}`}
						style={handle.axis === 'x' ? { left: position } : { top: position }}
						aria-label={`Crosshair ${id} ${handle.label}`}
						onPointerDown={(event) => startDrag(handle.axis, event)}
						{...handlers}
					>
						<span className={`absolute border-current ${handle.line}`} />
					</button>
				);
			})}

			{percent.x !== null && percent.y !== null && (
				<button
					type="button"
					className="pointer-events-auto absolute z-10 size-6 -translate-1/2 cursor-move border-0 bg-transparent p-0"
					style={{ left: percent.x, top: percent.y }}
					aria-label={`Move crosshair ${id}`}
					onPointerDown={(event) => startDrag('both', event)}
					{...handlers}
				>
					<span className="absolute top-1/2 left-1/2 size-3 -translate-1/2 rounded-full border-2 border-current bg-background" />
					<span className="absolute top-full left-full -mt-1 -ml-1 rounded-sm bg-foreground px-1 font-mono text-[0.625rem] leading-4 font-semibold text-background shadow-sm">
						{id}
					</span>
				</button>
			)}
		</div>
	);
}

function flushGesture(gesture: Gesture): void {
	if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
	gesture.frame = null;
	if (gesture.pending !== null) upsertCrosshair(gesture.pending);
	gesture.pending = null;
}

function cancelGesture(gesture: Gesture): void {
	const { drag } = gesture;
	gesture.drag = null;
	gesture.pending = null;
	flushGesture(gesture);
	if (drag?.target.hasPointerCapture(drag.pointerId))
		drag.target.releasePointerCapture(drag.pointerId);
}
