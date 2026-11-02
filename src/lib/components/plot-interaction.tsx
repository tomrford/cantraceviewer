import {
	useEffect,
	useEffectEvent,
	useRef,
	useState,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject
} from 'react';
import { useStore } from 'zustand';
import { ContextMenuTrigger } from '#lib/components/ui/context-menu.js';
import { plotWheelAction } from '#lib/plot-interaction-policy.js';
import { plotAreaRect, ratioInArea, type PlotRatioPoint } from '#lib/plot-pointer.js';
import {
	boxViewport,
	dataPointAtRatio,
	panViewport,
	type PlotPoint,
	type PlotViewport
} from '#lib/plot-viewport.js';
import { panBy, setPointerRatio, setViewport, zoomBy } from '#lib/stores/plot-view.js';
import { appStore } from '#lib/stores/store.js';

const WHEEL_ZOOM_SPEED = 0.002;

type DragState = { pointerId: number } & (
	| { type: 'pan'; clientX: number; clientY: number; startViewport: PlotViewport }
	| { type: 'box'; start: PlotRatioPoint; current: PlotRatioPoint }
);

/**
 * Pan, wheel zoom and box zoom over the plot, on the context-menu trigger that wraps the
 * interaction button and `children`. Moves write the viewport store and the box's DOM style
 * directly, so pointer movement never re-renders this component.
 */
export function PlotInteraction({
	plotSurface,
	onContextMenuPoint,
	children
}: {
	plotSurface: RefObject<HTMLElement | null>;
	onContextMenuPoint: (point: PlotPoint | null) => void;
	children: ReactNode;
}) {
	const boxZoomEnabled = useStore(appStore, (state) => state.boxZoomEnabled);
	const grid = useStore(appStore, (state) => state.plotModel.grid);
	const [panning, setPanning] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const boxRef = useRef<HTMLSpanElement>(null);
	const dragRef = useRef<DragState | null>(null);

	function plotArea() {
		const surface = plotSurface.current;
		return surface === null ? null : plotAreaRect(surface, grid);
	}

	function ratioAt(point: { clientX: number; clientY: number }) {
		const area = plotArea();
		return area === null ? null : ratioInArea(area, point);
	}

	function drawBox(start: PlotRatioPoint, end: PlotRatioPoint) {
		const box = boxRef.current;
		if (box === null) return;
		Object.assign(box.style, {
			display: '',
			left: `${Math.min(start.xRatio, end.xRatio) * 100}%`,
			top: `${Math.min(start.yRatio, end.yRatio) * 100}%`,
			width: `${Math.abs(end.xRatio - start.xRatio) * 100}%`,
			height: `${Math.abs(end.yRatio - start.yRatio) * 100}%`
		});
	}

	function startDrag(event: PointerEvent, type: 'pan' | 'box') {
		const startViewport = appStore.getState().activeViewport;
		const point = ratioAt(event);
		const button = buttonRef.current;
		if (startViewport === null || point === null || button === null) return;
		event.preventDefault();
		// Cancelling the press also stops the browser focusing the button, as a click normally would.
		button.focus({ preventScroll: true });
		// On the button even for a press on a crosshair handle, which unmounts when panned off-screen.
		button.setPointerCapture(event.pointerId);
		const { pointerId } = event;
		if (type === 'box') {
			dragRef.current = { pointerId, type, start: point, current: point };
			drawBox(point, point);
		} else {
			const { clientX, clientY } = event;
			dragRef.current = { pointerId, type, clientX, clientY, startViewport };
			setPanning(true);
		}
	}

	function startButtonDrag(event: PointerEvent) {
		if (event.button === 0) startDrag(event, boxZoomEnabled ? 'box' : 'pan');
	}

	function startMiddleDrag(event: PointerEvent) {
		if (event.button === 1) startDrag(event, 'pan');
	}

	function handlePointerMove(event: PointerEvent) {
		const point = ratioAt(event);
		setPointerRatio(point);
		const drag = dragRef.current;
		if (drag?.pointerId !== event.pointerId) return;
		event.preventDefault();
		if (drag.type === 'box') {
			if (point === null) return;
			drag.current = point;
			drawBox(drag.start, point);
			return;
		}
		const area = plotArea();
		if (area === null) return;
		const delta = { x: event.clientX - drag.clientX, y: event.clientY - drag.clientY };
		setViewport(panViewport(drag.startViewport, delta, area));
	}

	function cancelDrag() {
		const drag = dragRef.current;
		const button = buttonRef.current;
		dragRef.current = null;
		setPanning(false);
		if (boxRef.current !== null) boxRef.current.style.display = 'none';
		if (drag !== null && button?.hasPointerCapture(drag.pointerId)) {
			button.releasePointerCapture(drag.pointerId);
		}
	}

	function stopDrag(event: PointerEvent) {
		const drag = dragRef.current;
		if (drag?.pointerId !== event.pointerId) return;
		cancelDrag();
		const viewport = appStore.getState().activeViewport;
		if (drag.type !== 'box' || viewport === null) return;
		const next = boxViewport(viewport, drag.start, drag.current);
		if (next !== null) setViewport(next);
	}

	function preventMiddleAutoscroll(event: MouseEvent) {
		if (event.button === 1) event.preventDefault();
	}

	function rememberContextMenuPoint(event: MouseEvent) {
		const { activeViewport } = appStore.getState();
		const point = ratioAt(event);
		onContextMenuPoint(
			activeViewport === null || point === null ? null : dataPointAtRatio(activeViewport, point)
		);
	}

	const zoomOnWheel = useEffectEvent((event: WheelEvent) => {
		const area = plotArea();
		if (area === null || appStore.getState().activeViewport === null) return;
		const point = ratioInArea(area, event);
		if (point === null) return;
		const delta = normalizedWheelDelta(event, area.height);
		const action = plotWheelAction(delta, { shift: event.shiftKey, alt: event.altKey });
		if (action === null) return;

		event.preventDefault();
		if (action.type === 'pan-x') {
			panBy({ x: action.deltaX, y: 0 }, area);
			return;
		}
		const factor = Math.exp(Math.min(200, Math.max(-200, action.delta)) * WHEEL_ZOOM_SPEED);
		zoomBy(factor, point, action.axes);
	});

	const cancelBoxZoom = useEffectEvent((event: KeyboardEvent) => {
		if (event.key !== 'Escape' || dragRef.current?.type !== 'box') return;
		event.preventDefault();
		event.stopImmediatePropagation();
		cancelDrag();
	});

	// Native because React's wheel listener is passive and cannot cancel page zoom, and because
	// Escape has to reach this before the app's window shortcuts do.
	useEffect(() => {
		const wrapper = wrapperRef.current;
		if (wrapper === null) return;
		const controller = new AbortController();
		const { signal } = controller;
		wrapper.addEventListener('wheel', zoomOnWheel, { passive: false, signal });
		window.addEventListener('keydown', cancelBoxZoom, { capture: true, signal });
		return () => {
			controller.abort();
			setPointerRatio(null);
		};
	}, []);

	return (
		<ContextMenuTrigger
			ref={wrapperRef}
			className="contents"
			onPointerDownCapture={startMiddleDrag}
			onPointerMove={handlePointerMove}
			onPointerUp={stopDrag}
			onPointerCancel={stopDrag}
			onPointerLeave={() => setPointerRatio(null)}
			onAuxClick={preventMiddleAutoscroll}
		>
			<button
				ref={buttonRef}
				type="button"
				data-export-ignore
				className={`absolute inset-0 z-30 border-0 bg-transparent p-0 text-left outline-none ${
					boxZoomEnabled ? 'cursor-crosshair' : panning ? 'cursor-grabbing' : 'cursor-grab'
				}`}
				aria-label="Plot viewport interaction"
				onPointerDown={startButtonDrag}
				onContextMenu={rememberContextMenuPoint}
			>
				<span
					className="pointer-events-none absolute"
					style={{ top: grid.top, bottom: grid.bottom, left: grid.left, right: grid.right }}
				>
					<span
						ref={boxRef}
						className="absolute border border-current bg-current/10 text-foreground"
						style={{ display: 'none' }}
					/>
				</span>
			</button>
			{children}
		</ContextMenuTrigger>
	);
}

function normalizedWheelDelta(event: WheelEvent, pageHeight: number) {
	const unit =
		event.deltaMode === WheelEvent.DOM_DELTA_LINE
			? 16
			: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
				? pageHeight
				: 1;
	return { x: event.deltaX * unit, y: event.deltaY * unit };
}
