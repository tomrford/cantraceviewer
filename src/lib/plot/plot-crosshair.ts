import {
	ratioInRange,
	type PlotAxisRange,
	type PlotPoint,
	type PlotYWindow
} from '@/lib/plot/plot-viewport';

export type CrosshairId = 1 | 2;

export type PlotCrosshair = {
	id: CrosshairId;
	/** Trace-relative timestamp in milliseconds. */
	x: number;
	/** Fraction from the top of the unzoomed Y fit; deliberately unbounded. */
	yRatio: number;
};

export type LegendCrosshairMode = 'c1' | 'c2' | 'delta';
export type CrosshairDragAxis = 'x' | 'y' | 'both';

export function crosshairFromPoint(
	point: PlotPoint & { id: CrosshairId },
	range: PlotAxisRange,
	window: PlotYWindow
): PlotCrosshair {
	return {
		id: point.id,
		x: point.x,
		yRatio: window.top + ratioInRange(range, point.y) * (window.bottom - window.top)
	};
}

export function crosshairYRatio(crosshair: PlotCrosshair, window: PlotYWindow): number {
	return (crosshair.yRatio - window.top) / (window.bottom - window.top);
}

export function crosshairById(crosshairs: PlotCrosshair[], id: CrosshairId): PlotCrosshair | null {
	return crosshairs.find((crosshair) => crosshair.id === id) ?? null;
}

export function setCrosshair(
	crosshairs: PlotCrosshair[],
	crosshair: PlotCrosshair
): PlotCrosshair[] {
	return [...crosshairs.filter((item) => item.id !== crosshair.id), crosshair].sort(
		(a, b) => a.id - b.id
	);
}

export function removeCrosshair(crosshairs: PlotCrosshair[], id: CrosshairId): PlotCrosshair[] {
	return crosshairs.filter((crosshair) => crosshair.id !== id);
}

export function moveCrosshair(
	crosshair: PlotCrosshair,
	point: Pick<PlotCrosshair, 'x' | 'yRatio'>,
	axis: CrosshairDragAxis
): PlotCrosshair {
	return {
		...crosshair,
		x: axis === 'y' ? crosshair.x : point.x,
		yRatio: axis === 'x' ? crosshair.yRatio : point.yRatio
	};
}
