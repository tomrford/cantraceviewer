import { AXIS_FONT_SIZE, generateValueAxisTicks, Y_TICK_COUNT } from '@/lib/plot/plot-axis-layout';
import type { PlotBackend, PlotFrame } from '@/lib/plot/plot-backend';
import { TIME_LABEL_GAP_PX, timeAxisTicks } from '@/lib/plot/plot-time-axis';
import type { PlotAxisRange } from '@/lib/plot/plot-viewport';
import { formatAxisTime, type WindowedSignalView } from '@/lib/plot/signal-plot-data';
import { PRIMARY_Y_AXIS_ID } from '@/lib/plot/y-axis';

const LINE_WIDTH = 2.5;
// ChartGPU fades inward at each edge. Approximate its visible width with one Canvas stroke.
const LINE_EDGE_FADE_DEVICE_PX = 1.25;
const LINE_OPACITY = 0.95;
const MARKER_RADIUS = 1.5;
const X_TICK_LENGTH = 6;
const X_LABEL_OFFSET = 10;
const EDGE_ANCHOR_PX = 12;

type PlotBox = {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
};

/**
 * Software-safe Canvas 2D fallback backend used automatically when WebGPU is unavailable.
 * Draws the same grid, X-axis ticks/labels, polylines and sample markers inside `frame.grid`
 * so DOM overlays (Y gutters, crosshairs, interactions and image export) align identically.
 */
export function createCanvasBackend(surface: HTMLElement, initialFrame: PlotFrame): PlotBackend {
	const canvas = document.createElement('canvas');
	const maybeContext = canvas.getContext('2d');
	if (maybeContext === null) {
		throw new Error('Could not acquire a 2D canvas context.');
	}
	const ctx: CanvasRenderingContext2D = maybeContext;

	canvas.style.display = 'block';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
	surface.appendChild(canvas);

	let lastFrame = initialFrame;
	let cssWidth = 0;
	let cssHeight = 0;
	let dpr = 1;
	let disposed = false;

	function syncSize(): { ready: boolean; changed: boolean } {
		const width = Math.max(0, Math.floor(surface.clientWidth));
		const height = Math.max(0, Math.floor(surface.clientHeight));
		const nextDpr = window.devicePixelRatio || 1;
		const changed = width !== cssWidth || height !== cssHeight || nextDpr !== dpr;
		if (changed) {
			cssWidth = width;
			cssHeight = height;
			dpr = nextDpr;
			canvas.width = Math.max(1, Math.round(width * dpr));
			canvas.height = Math.max(1, Math.round(height * dpr));
		}
		return { ready: width > 0 && height > 0, changed };
	}

	function paint(frame: PlotFrame): void {
		if (disposed) return;
		lastFrame = frame;
		if (!syncSize().ready) return;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const { theme, grid, axisRanges } = frame;
		ctx.fillStyle = theme.background;
		ctx.fillRect(0, 0, cssWidth, cssHeight);

		const box: PlotBox = {
			left: grid.left,
			right: cssWidth - grid.right,
			top: grid.top,
			bottom: cssHeight - grid.bottom,
			width: cssWidth - grid.left - grid.right,
			height: cssHeight - grid.top - grid.bottom
		};
		if (box.width <= 0 || box.height <= 0) {
			ctx.restore();
			return;
		}

		const validX =
			frame.xRange !== null && frame.xRange.max > frame.xRange.min ? frame.xRange : null;
		const primaryY = axisRanges.get(PRIMARY_Y_AXIS_ID);
		const validPrimaryY = primaryY !== undefined && primaryY.max > primaryY.min ? primaryY : null;
		const yTicks = validPrimaryY
			? generateValueAxisTicks(validPrimaryY.min, validPrimaryY.max, Y_TICK_COUNT)
			: [];
		ctx.font = `${AXIS_FONT_SIZE}px ${theme.fontFamily}`;
		const xLabels = new Map<number, { text: string; width: number }>();
		const xTicks = validX
			? timeAxisTicks(validX, box.width, (tick) => {
					const text = formatAxisTime(tick, frame.timeFormat);
					const width = ctx.measureText(text).width;
					xLabels.set(tick, { text, width });
					return width;
				})
			: [];

		drawGridLines(ctx, box, theme.gridLine, validX, xTicks, validPrimaryY, yTicks);

		if (validX !== null) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(box.left, box.top, box.width, box.height);
			ctx.clip();

			const strokeWidth = Math.max(1, LINE_WIDTH - LINE_EDGE_FADE_DEVICE_PX / dpr);
			for (const view of frame.views) {
				const axisId = frame.axisIdByKey.get(view.signal.key) ?? PRIMARY_Y_AXIS_ID;
				const yRange = axisRanges.get(axisId);
				if (yRange !== undefined && yRange.max > yRange.min) {
					drawSeries(ctx, box, view, validX, yRange, strokeWidth);
				}
			}

			ctx.restore();
			drawXAxis(ctx, box, frame, validX, xTicks, xLabels);
		}

		ctx.restore();
	}

	paint(initialFrame);

	return {
		kind: 'canvas',
		render(frame) {
			paint(frame);
		},
		resize() {
			if (!disposed && syncSize().changed) paint(lastFrame);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			canvas.remove();
		}
	};
}

function drawGridLines(
	ctx: CanvasRenderingContext2D,
	box: PlotBox,
	color: string,
	xRange: PlotAxisRange | null,
	xTicks: readonly number[],
	yRange: PlotAxisRange | null,
	yTicks: readonly number[]
): void {
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.beginPath();

	if (yRange !== null) {
		const ySpan = yRange.max - yRange.min;
		for (const tick of yTicks) {
			const y = Math.round(box.top + ((yRange.max - tick) / ySpan) * box.height) + 0.5;
			ctx.moveTo(box.left, y);
			ctx.lineTo(box.right, y);
		}
	}

	if (xRange !== null) {
		const xSpan = xRange.max - xRange.min;
		for (const tick of xTicks) {
			const x = Math.round(box.left + ((tick - xRange.min) / xSpan) * box.width) + 0.5;
			ctx.moveTo(x, box.top);
			ctx.lineTo(x, box.bottom);
		}
	}

	ctx.stroke();
}

function drawSeries(
	ctx: CanvasRenderingContext2D,
	box: PlotBox,
	view: WindowedSignalView,
	xRange: PlotAxisRange,
	yRange: PlotAxisRange,
	strokeWidth: number
): void {
	const { x, y } = view;
	const count = Math.min(x.length, y.length);
	if (count === 0) return;

	const xMin = xRange.min;
	const xMax = xRange.max;
	const yMax = yRange.max;
	const xScale = box.width / (xMax - xMin);
	const yScale = box.height / (yMax - yRange.min);

	ctx.strokeStyle = view.color;
	ctx.lineWidth = strokeWidth;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.globalAlpha = LINE_OPACITY;
	ctx.beginPath();

	let penDown = false;
	for (let i = 0; i < count; i += 1) {
		const xv = x[i];
		const yv = y[i];
		if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
			penDown = false;
			continue;
		}
		// Keep one sample past each horizontal edge so segments crossing the viewport clip cleanly.
		if (xv < xMin && i + 1 < count && x[i + 1] < xMin) {
			penDown = false;
			continue;
		}
		if (xv > xMax && i > 0 && x[i - 1] > xMax) break;

		const px = box.left + (xv - xMin) * xScale;
		const py = box.top + (yMax - yv) * yScale;
		if (!penDown) {
			ctx.moveTo(px, py);
			penDown = true;
		} else {
			ctx.lineTo(px, py);
		}
	}
	ctx.stroke();

	if (!view.sampled) {
		ctx.fillStyle = view.color;
		ctx.globalAlpha = 1;
		ctx.beginPath();
		for (let i = 0; i < count; i += 1) {
			const xv = x[i];
			const yv = y[i];
			if (!Number.isFinite(xv) || !Number.isFinite(yv) || xv < xMin) continue;
			if (xv > xMax) break;
			const py = box.top + (yMax - yv) * yScale;
			if (py < box.top - MARKER_RADIUS || py > box.bottom + MARKER_RADIUS) continue;
			const px = box.left + (xv - xMin) * xScale;
			ctx.moveTo(px + MARKER_RADIUS, py);
			ctx.arc(px, py, MARKER_RADIUS, 0, Math.PI * 2);
		}
		ctx.fill();
	}

	ctx.globalAlpha = 1;
}

function drawXAxis(
	ctx: CanvasRenderingContext2D,
	box: PlotBox,
	frame: PlotFrame,
	xRange: PlotAxisRange,
	xTicks: readonly number[],
	xLabels: ReadonlyMap<number, { text: string; width: number }>
): void {
	const { theme, timeFormat } = frame;
	const baselineY = Math.round(box.bottom) + 0.5;

	ctx.strokeStyle = theme.axisLine;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(box.left, baselineY);
	ctx.lineTo(box.right, baselineY);
	ctx.stroke();

	if (xTicks.length === 0) return;

	const xSpan = xRange.max - xRange.min;

	ctx.strokeStyle = theme.axisTick;
	ctx.beginPath();
	for (const tick of xTicks) {
		const x = Math.round(box.left + ((tick - xRange.min) / xSpan) * box.width) + 0.5;
		ctx.moveTo(x, baselineY);
		ctx.lineTo(x, baselineY + X_TICK_LENGTH);
	}
	ctx.stroke();

	ctx.fillStyle = theme.text;
	ctx.textBaseline = 'top';
	const labelY = box.bottom + X_LABEL_OFFSET;
	const anchorEdges = xTicks.length > 1;
	const canvasRight = box.right + frame.grid.right;

	let previousRight = -Infinity;
	let previousLabel = '';
	for (const tick of xTicks) {
		const measured = xLabels.get(tick);
		const label = measured?.text ?? formatAxisTime(tick, timeFormat);
		if (!label || label === previousLabel) continue;
		const x = box.left + ((tick - xRange.min) / xSpan) * box.width;
		const halfWidth = (measured?.width ?? ctx.measureText(label).width) / 2;
		let left = x - halfWidth;
		ctx.textAlign = 'center';
		if (x < halfWidth || (anchorEdges && x - box.left <= EDGE_ANCHOR_PX)) {
			ctx.textAlign = 'left';
			left = x;
		} else if (x + halfWidth > canvasRight || (anchorEdges && box.right - x <= EDGE_ANCHOR_PX)) {
			ctx.textAlign = 'right';
			left = x - 2 * halfWidth;
		}
		if (left < previousRight + TIME_LABEL_GAP_PX) continue;
		ctx.fillText(label, x, labelY);
		previousRight = left + 2 * halfWidth;
		previousLabel = label;
	}
}
