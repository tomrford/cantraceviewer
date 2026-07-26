export type PlotViewport = {
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
};

export type PlotPoint = {
	x: number;
	y: number;
};

/** One axis's bounds, used where only a y range is in play. */
export type PlotAxisRange = {
	min: number;
	max: number;
};

/**
 * The slice of a y fit range currently in view, in ratio space, where 0 is the
 * top of the range and 1 the bottom.
 *
 * Y navigation is uniform across axes: one gesture moves every axis by the same
 * proportion of its own extent, so each axis keeps fitting its own data while
 * the lines move together on screen exactly as they do with a single axis.
 */
export type PlotYWindow = {
	top: number;
	bottom: number;
};

export const FULL_Y_WINDOW: PlotYWindow = { top: 0, bottom: 1 };

const X_PADDING = 0;
const Y_PADDING = 0.05;
const MIN_SPAN = 1e-9;
const EQUAL_TOLERANCE = 1e-6;

export function paddedRange(
	min: number,
	max: number,
	paddingFraction: number
): PlotAxisRange | null {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
	if (min === max) {
		const padding = Math.max(1, Math.abs(min) * 0.05);
		return { min: min - padding, max: max + padding };
	}

	const padding = (max - min) * paddingFraction;
	return { min: min - padding, max: max + padding };
}

export function paddedXRange(min: number, max: number): PlotAxisRange | null {
	return paddedRange(min, max, X_PADDING);
}

export function paddedYRange(min: number, max: number): PlotAxisRange | null {
	return paddedRange(min, max, Y_PADDING);
}

export function paddedViewport(
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number
): PlotViewport | null {
	const x = paddedXRange(xMin, xMax);
	const y = paddedYRange(yMin, yMax);
	if (x === null || y === null) return null;

	return { xMin: x.min, xMax: x.max, yMin: y.min, yMax: y.max };
}

/** The y slice `viewport` shows of `domain`, in ratio space. */
export function yWindowOf(domain: PlotViewport, viewport: PlotViewport): PlotYWindow {
	const span = domain.yMax - domain.yMin;
	if (!(span > 0)) return FULL_Y_WINDOW;

	return {
		top: (domain.yMax - viewport.yMax) / span,
		bottom: (domain.yMax - viewport.yMin) / span
	};
}

/** Applies a y window to another axis's fit range, giving that axis's bounds. */
export function applyYWindow(range: PlotAxisRange, window: PlotYWindow): PlotAxisRange {
	const span = range.max - range.min;
	return {
		min: range.max - window.bottom * span,
		max: range.max - window.top * span
	};
}

/** Where `value` sits in `range`, as a ratio from the top. */
export function ratioInRange(range: PlotAxisRange, value: number): number {
	const span = range.max - range.min;
	return span === 0 ? 0.5 : (range.max - value) / span;
}

export function valueAtRatio(range: PlotAxisRange, ratio: number): number {
	return range.max - ratio * (range.max - range.min);
}

export function viewportCenterX(viewport: Pick<PlotViewport, 'xMin' | 'xMax'>): number {
	return viewport.xMin + (viewport.xMax - viewport.xMin) / 2;
}

export function viewportCenter(viewport: PlotViewport): PlotPoint {
	return {
		x: viewportCenterX(viewport),
		y: viewport.yMin + (viewport.yMax - viewport.yMin) / 2
	};
}

export function dataPointAtRatio(
	viewport: PlotViewport,
	point: { xRatio: number; yRatio: number }
): PlotPoint {
	const xRatio = clamp(point.xRatio, 0, 1);
	const yRatio = clamp(point.yRatio, 0, 1);
	return {
		x: viewport.xMin + xRatio * (viewport.xMax - viewport.xMin),
		y: viewport.yMax - yRatio * (viewport.yMax - viewport.yMin)
	};
}

export function ratioAtDataPoint(
	viewport: PlotViewport,
	point: PlotPoint
): {
	xRatio: number;
	yRatio: number;
} {
	return {
		xRatio: (point.x - viewport.xMin) / (viewport.xMax - viewport.xMin),
		yRatio: (viewport.yMax - point.y) / (viewport.yMax - viewport.yMin)
	};
}

export function viewportsAlmostEqual(a: PlotViewport | null, b: PlotViewport | null): boolean {
	if (a === null || b === null) return a === b;
	return (
		almostEqual(a.xMin, b.xMin) &&
		almostEqual(a.xMax, b.xMax) &&
		almostEqual(a.yMin, b.yMin) &&
		almostEqual(a.yMax, b.yMax)
	);
}

export function panViewport(
	viewport: PlotViewport,
	deltaPixels: { x: number; y: number },
	plotSize: { width: number; height: number }
): PlotViewport {
	const xSpan = viewport.xMax - viewport.xMin;
	const ySpan = viewport.yMax - viewport.yMin;
	const xDelta = plotSize.width > 0 ? (-deltaPixels.x / plotSize.width) * xSpan : 0;
	const yDelta = plotSize.height > 0 ? (deltaPixels.y / plotSize.height) * ySpan : 0;

	return {
		xMin: viewport.xMin + xDelta,
		xMax: viewport.xMax + xDelta,
		yMin: viewport.yMin + yDelta,
		yMax: viewport.yMax + yDelta
	};
}

export function zoomViewport(
	viewport: PlotViewport,
	factor: number,
	anchor: { xRatio: number; yRatio: number },
	axes: { x: boolean; y: boolean } = { x: true, y: true }
): PlotViewport {
	if (!Number.isFinite(factor) || !(factor > 0)) return viewport;
	const xRatio = clamp(anchor.xRatio, 0, 1);
	const yRatio = clamp(anchor.yRatio, 0, 1);
	const next = { ...viewport };

	if (axes.x) {
		const xAnchor = viewport.xMin + xRatio * (viewport.xMax - viewport.xMin);
		const xSpan = Math.max(MIN_SPAN, (viewport.xMax - viewport.xMin) * factor);
		next.xMin = xAnchor - xRatio * xSpan;
		next.xMax = next.xMin + xSpan;
	}

	if (axes.y) {
		const yAnchor = viewport.yMax - yRatio * (viewport.yMax - viewport.yMin);
		const ySpan = Math.max(MIN_SPAN, (viewport.yMax - viewport.yMin) * factor);
		next.yMax = yAnchor + yRatio * ySpan;
		next.yMin = next.yMax - ySpan;
	}

	return next;
}

export function boxViewport(
	viewport: PlotViewport,
	start: { xRatio: number; yRatio: number },
	end: { xRatio: number; yRatio: number }
): PlotViewport | null {
	const left = clamp(Math.min(start.xRatio, end.xRatio), 0, 1);
	const right = clamp(Math.max(start.xRatio, end.xRatio), 0, 1);
	const top = clamp(Math.min(start.yRatio, end.yRatio), 0, 1);
	const bottom = clamp(Math.max(start.yRatio, end.yRatio), 0, 1);
	if (right - left < 0.005 || bottom - top < 0.005) return null;

	const xSpan = viewport.xMax - viewport.xMin;
	const ySpan = viewport.yMax - viewport.yMin;
	return {
		xMin: viewport.xMin + left * xSpan,
		xMax: viewport.xMin + right * xSpan,
		yMin: viewport.yMax - bottom * ySpan,
		yMax: viewport.yMax - top * ySpan
	};
}

function almostEqual(a: number, b: number): boolean {
	const scale = Math.max(1, Math.abs(a), Math.abs(b));
	return Math.abs(a - b) <= EQUAL_TOLERANCE * scale;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
