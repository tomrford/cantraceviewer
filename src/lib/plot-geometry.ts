export type PlotGrid = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

export type PlotRatioPoint = {
	xRatio: number;
	yRatio: number;
};

export function pointerToPlotRatio(
	rect: DOMRect,
	grid: PlotGrid,
	event: Pick<PointerEvent, 'clientX' | 'clientY'>
): PlotRatioPoint | null {
	const plotLeft = rect.left + grid.left;
	const plotRight = rect.right - grid.right;
	const plotTop = rect.top + grid.top;
	const plotBottom = rect.bottom - grid.bottom;
	const plotWidth = plotRight - plotLeft;
	const plotHeight = plotBottom - plotTop;
	if (!(plotWidth > 0) || !(plotHeight > 0)) return null;

	return {
		xRatio: clamp((event.clientX - plotLeft) / plotWidth, 0, 1),
		yRatio: clamp((event.clientY - plotTop) / plotHeight, 0, 1)
	};
}

export function plotSize(rect: DOMRect, grid: PlotGrid): { width: number; height: number } {
	return {
		width: Math.max(0, rect.width - grid.left - grid.right),
		height: Math.max(0, rect.height - grid.top - grid.bottom)
	};
}

export function normalizedWheelDelta(
	event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>,
	pageHeight: number
): { x: number; y: number } {
	const unit =
		event.deltaMode === WheelEvent.DOM_DELTA_LINE
			? 16
			: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
				? pageHeight || 800
				: 1;
	return { x: event.deltaX * unit, y: event.deltaY * unit };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
