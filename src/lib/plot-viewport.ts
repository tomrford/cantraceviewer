export type PlotViewport = {
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
};

const MIN_SPAN = 1e-9;
const EQUAL_TOLERANCE = 1e-6;

export function paddedViewport(
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number
): PlotViewport | null {
	if (
		!Number.isFinite(xMin) ||
		!Number.isFinite(xMax) ||
		!Number.isFinite(yMin) ||
		!Number.isFinite(yMax)
	) {
		return null;
	}

	return {
		...paddedAxis(xMin, xMax, 0),
		...yAxis(paddedAxis(yMin, yMax, 0.05))
	};
}

export function viewportCenterX(viewport: Pick<PlotViewport, 'xMin' | 'xMax'>): number {
	return viewport.xMin + (viewport.xMax - viewport.xMin) / 2;
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

export function viewportIndicator(viewport: PlotViewport, fullDomain: PlotViewport) {
	const fullXSpan = fullDomain.xMax - fullDomain.xMin;
	const fullYSpan = fullDomain.yMax - fullDomain.yMin;

	return {
		xLeft: fullXSpan > 0 ? ((viewport.xMin - fullDomain.xMin) / fullXSpan) * 100 : 0,
		xWidth: fullXSpan > 0 ? ((viewport.xMax - viewport.xMin) / fullXSpan) * 100 : 100,
		yTop: fullYSpan > 0 ? ((fullDomain.yMax - viewport.yMax) / fullYSpan) * 100 : 0,
		yHeight: fullYSpan > 0 ? ((viewport.yMax - viewport.yMin) / fullYSpan) * 100 : 100
	};
}

function paddedAxis(
	min: number,
	max: number,
	paddingFraction: number
): Pick<PlotViewport, 'xMin' | 'xMax'> {
	if (min === max) {
		const padding = Math.max(1, Math.abs(min) * 0.05);
		return { xMin: min - padding, xMax: max + padding };
	}

	const padding = (max - min) * paddingFraction;
	return { xMin: min - padding, xMax: max + padding };
}

function yAxis(axis: Pick<PlotViewport, 'xMin' | 'xMax'>): Pick<PlotViewport, 'yMin' | 'yMax'> {
	return { yMin: axis.xMin, yMax: axis.xMax };
}

function almostEqual(a: number, b: number): boolean {
	const scale = Math.max(1, Math.abs(a), Math.abs(b));
	return Math.abs(a - b) <= EQUAL_TOLERANCE * scale;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
