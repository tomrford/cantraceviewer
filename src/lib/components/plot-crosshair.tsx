import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { useStore } from 'zustand';
import {
	crosshairById,
	moveCrosshair,
	type CrosshairDragAxis,
	type CrosshairId
} from '#lib/plot-crosshair.js';
import { ratioInArea } from '#lib/plot-pointer.js';
import { dataPointAtRatio, ratioAtDataPoint, type PlotPoint } from '#lib/plot-viewport.js';
import { upsertCrosshair } from '#lib/stores/plot-view.js';
import { appStore } from '#lib/stores/store.js';

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
	const crosshair = useStore(appStore, (state) => crosshairById(state.crosshairs, id));
	const viewport = useStore(appStore, (state) => state.activeViewport);
	const grid = useStore(appStore, (state) => state.plotModel.grid);
	const track = useRef<HTMLDivElement>(null);

	function pointAt(event: { clientX: number; clientY: number }): PlotPoint | null {
		const activeViewport = appStore.getState().activeViewport;
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
		event.currentTarget.setPointerCapture(event.pointerId);
		moveTo(axis, event);
	}

	function moveDrag(axis: CrosshairDragAxis, event: PointerEvent<HTMLElement>) {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		event.preventDefault();
		moveTo(axis, event);
	}

	function moveTo(axis: CrosshairDragAxis, event: PointerEvent) {
		const current = crosshairById(appStore.getState().crosshairs, id);
		const point = pointAt(event);
		if (current !== null && point !== null) upsertCrosshair(moveCrosshair(current, point, axis));
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
						onContextMenu={rememberContextMenuPoint}
						onPointerDown={(event) => startDrag(handle.axis, event)}
						onPointerMove={(event) => moveDrag(handle.axis, event)}
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
					onContextMenu={rememberContextMenuPoint}
					onPointerDown={(event) => startDrag('both', event)}
					onPointerMove={(event) => moveDrag('both', event)}
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
