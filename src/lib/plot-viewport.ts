import type { PlotRatioPoint } from './plot-pointer.js';

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

export type PlotAxisRange = {
	min: number;
	max: number;
};

export type PlotYWindow = {
	top: number;
	bottom: number;
};

export const FULL_Y_WINDOW: PlotYWindow = { top: 0, bottom: 1 };

const X_PADDING = 0;
const Y_PADDING = 0.05;
const MIN_SPAN = 1e-9;
const EQUAL_TOLERANCE = 1e-6;

function paddedRange(min: number, max: number, paddingFraction: number): PlotAxisRange | null {
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

export function advanceYWindow(
	window: PlotYWindow,
	from: PlotViewport,
	to: PlotViewport
): PlotYWindow {
	const span = from.yMax - from.yMin;
	if (!(span > 0)) return window;

	const windowSpan = window.bottom - window.top;
	return {
		top: window.top + ((from.yMax - to.yMax) / span) * windowSpan,
		bottom: window.top + ((from.yMax - to.yMin) / span) * windowSpan
	};
}

export function applyYWindow(range: PlotAxisRange, window: PlotYWindow): PlotAxisRange {
	const span = range.max - range.min;
	return {
		min: range.max - window.bottom * span,
		max: range.max - window.top * span
	};
}

export function ratioInRange(range: PlotAxisRange, value: number): number {
	const span = range.max - range.min;
	return span === 0 ? 0.5 : (range.max - value) / span;
}

export function valueAtRatio(range: PlotAxisRange, ratio: number): number {
	return range.max - ratio * (range.max - range.min);
}

export function viewportCenter(viewport: PlotViewport): PlotPoint {
	return {
		x: viewport.xMin + (viewport.xMax - viewport.xMin) / 2,
		y: viewport.yMin + (viewport.yMax - viewport.yMin) / 2
	};
}

export function dataPointAtRatio(viewport: PlotViewport, point: PlotRatioPoint): PlotPoint {
	return {
		x: viewport.xMin + point.xRatio * (viewport.xMax - viewport.xMin),
		y: viewport.yMax - point.yRatio * (viewport.yMax - viewport.yMin)
	};
}

export function ratioAtDataPoint(viewport: PlotViewport, point: PlotPoint) {
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
	{ xRatio, yRatio }: PlotRatioPoint,
	axes: { x: boolean; y: boolean } = { x: true, y: true }
): PlotViewport {
	if (!Number.isFinite(factor) || !(factor > 0)) return viewport;
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
	start: PlotRatioPoint,
	end: PlotRatioPoint
): PlotViewport | null {
	const left = Math.min(start.xRatio, end.xRatio);
	const right = Math.max(start.xRatio, end.xRatio);
	const top = Math.min(start.yRatio, end.yRatio);
	const bottom = Math.max(start.yRatio, end.yRatio);
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
