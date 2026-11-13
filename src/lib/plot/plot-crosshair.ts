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
	/**
	 * Height as a fraction from the top of the unzoomed Y fit, so it holds through axis changes.
	 * Unbounded: zoom and pan can leave it off the plot.
	 */
	fitY: number;
};

export type LegendCrosshairMode = 'c1' | 'c2' | 'delta';
export type CrosshairDragAxis = 'x' | 'y' | 'both';

/** A crosshair at a point in primary-axis units. */
export function crosshairAt(
	point: PlotPoint & { id: CrosshairId },
	primaryFit: PlotAxisRange
): PlotCrosshair {
	return { id: point.id, x: point.x, fitY: ratioInRange(primaryFit, point.y) };
}

/** The crosshair's height as a fraction of the visible plot, from the top. */
export function crosshairViewRatio(crosshair: PlotCrosshair, window: PlotYWindow): number {
	return (crosshair.fitY - window.top) / (window.bottom - window.top);
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
	point: Pick<PlotCrosshair, 'x' | 'fitY'>,
	axis: CrosshairDragAxis
): PlotCrosshair {
	return {
		...crosshair,
		x: axis === 'y' ? crosshair.x : point.x,
		fitY: axis === 'x' ? crosshair.fitY : point.fitY
	};
}
