import { AXIS_FONT_SIZE, generateValueAxisTicks, Y_TICK_COUNT } from '@/lib/plot/plot-axis-layout';
import type { PlotBackend, PlotFrame } from '@/lib/plot/plot-backend';
import { formatAxisTime, type WindowedSignalView } from '@/lib/plot/signal-plot-data';
import { PRIMARY_Y_AXIS_ID } from '@/lib/plot/y-axis';

const LINE_WIDTH = 2.5;
const LINE_OPACITY = 0.95;
const MARKER_RADIUS = 1.5;
const X_TICK_LENGTH = 6;
const X_LABEL_OFFSET = 10;
const X_LABEL_MIN_GAP = 10;
const X_TICK_SPACING_PX = 140;
const EDGE_ANCHOR_PX = 24;

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
	let stopDprWatch: (() => void) | null = null;

	function watchDpr(): void {
		stopDprWatch?.();
		stopDprWatch = null;
		if (disposed || typeof window.matchMedia !== 'function') return;
		const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
		const handleChange = () => {
			if (disposed) return;
			watchDpr();
			paint(lastFrame);
		};
		media.addEventListener('change', handleChange, { once: true });
		stopDprWatch = () => media.removeEventListener('change', handleChange);
	}

	function syncSize(): boolean {
		const width = Math.max(0, Math.floor(surface.clientWidth));
		const height = Math.max(0, Math.floor(surface.clientHeight));
		const nextDpr = window.devicePixelRatio || 1;
		if (width === cssWidth && height === cssHeight && nextDpr === dpr) {
			return width > 0 && height > 0;
		}

		cssWidth = width;
		cssHeight = height;
		dpr = nextDpr;
		canvas.width = Math.max(1, Math.round(width * dpr));
		canvas.height = Math.max(1, Math.round(height * dpr));
		return width > 0 && height > 0;
	}

	function paint(frame: PlotFrame): void {
		if (disposed) return;
		lastFrame = frame;
		if (!syncSize()) return;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const { theme, grid, xRange, axisRanges } = frame;
		ctx.fillStyle = theme.background;
		ctx.fillRect(0, 0, cssWidth, cssHeight);

		const plotLeft = grid.left;
		const plotRight = cssWidth - grid.right;
		const plotTop = grid.top;
		const plotBottom = cssHeight - grid.bottom;
		const plotWidth = plotRight - plotLeft;
		const plotHeight = plotBottom - plotTop;
		if (plotWidth <= 0 || plotHeight <= 0) {
			ctx.restore();
			return;
		}

		const primaryY = axisRanges.get(PRIMARY_Y_AXIS_ID) ?? null;
		const yTicks =
			primaryY !== null && primaryY.max > primaryY.min
				? generateValueAxisTicks(primaryY.min, primaryY.max, Y_TICK_COUNT)
				: [];
		const xTickCount = Math.max(2, Math.min(8, Math.floor(plotWidth / X_TICK_SPACING_PX)));
		const xTicks =
			xRange !== null && xRange.max > xRange.min
				? generateValueAxisTicks(xRange.min, xRange.max, xTickCount)
				: [];

		drawGridLines(
			ctx,
			theme.gridLine,
			plotLeft,
			plotRight,
			plotTop,
			plotBottom,
			xRange,
			xTicks,
			primaryY,
			yTicks
		);

		if (xRange !== null && xRange.max > xRange.min) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
			ctx.clip();

			for (const view of frame.views) {
				const axisId = frame.axisIdByKey.get(view.signal.key) ?? PRIMARY_Y_AXIS_ID;
				const yRange = axisRanges.get(axisId);
				if (yRange === undefined || !(yRange.max > yRange.min)) continue;
				drawSeries(ctx, view, plotLeft, plotTop, plotWidth, plotHeight, xRange, yRange);
			}

			ctx.restore();
		}

		drawXAxis(ctx, frame, plotLeft, plotRight, plotBottom, xRange, xTicks);
		ctx.restore();
	}

	watchDpr();
	paint(initialFrame);

	return {
		kind: 'canvas',
		render(frame) {
			paint(frame);
		},
		resize() {
			paint(lastFrame);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stopDprWatch?.();
			stopDprWatch = null;
			canvas.remove();
		}
	};
}

function drawGridLines(
	ctx: CanvasRenderingContext2D,
	color: string,
	plotLeft: number,
	plotRight: number,
	plotTop: number,
	plotBottom: number,
	xRange: PlotFrame['xRange'],
	xTicks: readonly number[],
	yRange: PlotFrame['xRange'],
	yTicks: readonly number[]
): void {
	const plotWidth = plotRight - plotLeft;
	const plotHeight = plotBottom - plotTop;
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.beginPath();

	if (yRange !== null && yRange.max > yRange.min) {
		const ySpan = yRange.max - yRange.min;
		for (const tick of yTicks) {
			const y = Math.round(plotTop + ((yRange.max - tick) / ySpan) * plotHeight) + 0.5;
			ctx.moveTo(plotLeft, y);
			ctx.lineTo(plotRight, y);
		}
	}

	if (xRange !== null && xRange.max > xRange.min) {
		const xSpan = xRange.max - xRange.min;
		for (const tick of xTicks) {
			const x = Math.round(plotLeft + ((tick - xRange.min) / xSpan) * plotWidth) + 0.5;
			ctx.moveTo(x, plotTop);
			ctx.lineTo(x, plotBottom);
		}
	}

	ctx.stroke();
}

function drawSeries(
	ctx: CanvasRenderingContext2D,
	view: WindowedSignalView,
	plotLeft: number,
	plotTop: number,
	plotWidth: number,
	plotHeight: number,
	xRange: NonNullable<PlotFrame['xRange']>,
	yRange: NonNullable<PlotFrame['xRange']>
): void {
	const { x, y } = view;
	const count = Math.min(x.length, y.length);
	if (count === 0) return;

	const xMin = xRange.min;
	const xMax = xRange.max;
	const yMax = yRange.max;
	const xScale = plotWidth / (xMax - xMin);
	const yScale = plotHeight / (yMax - yRange.min);

	ctx.strokeStyle = view.color;
	ctx.lineWidth = LINE_WIDTH;
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
		if (xv > xMax && i > 0 && x[i - 1] > xMax) {
			break;
		}

		const px = plotLeft + (xv - xMin) * xScale;
		const py = plotTop + (yMax - yv) * yScale;
		if (!penDown) {
			ctx.moveTo(px, py);
			penDown = true;
		} else {
			ctx.lineTo(px, py);
		}
	}
	ctx.stroke();

	if (!view.sampled) {
		const plotRight = plotLeft + plotWidth;
		const plotBottom = plotTop + plotHeight;
		ctx.fillStyle = view.color;
		ctx.globalAlpha = 1;
		ctx.beginPath();
		for (let i = 0; i < count; i += 1) {
			const xv = x[i];
			const yv = y[i];
			if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
			if (xv < xMin) continue;
			if (xv > xMax) break;
			const px = plotLeft + (xv - xMin) * xScale;
			const py = plotTop + (yMax - yv) * yScale;
			if (px < plotLeft - MARKER_RADIUS || px > plotRight + MARKER_RADIUS) continue;
			if (py < plotTop - MARKER_RADIUS || py > plotBottom + MARKER_RADIUS) continue;
			ctx.moveTo(px + MARKER_RADIUS, py);
			ctx.arc(px, py, MARKER_RADIUS, 0, Math.PI * 2);
		}
		ctx.fill();
	}

	ctx.globalAlpha = 1;
}

function drawXAxis(
	ctx: CanvasRenderingContext2D,
	frame: PlotFrame,
	plotLeft: number,
	plotRight: number,
	plotBottom: number,
	xRange: PlotFrame['xRange'],
	xTicks: readonly number[]
): void {
	const { theme, timeFormat } = frame;
	const baselineY = Math.round(plotBottom) + 0.5;

	ctx.strokeStyle = theme.axisLine;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(plotLeft, baselineY);
	ctx.lineTo(plotRight, baselineY);
	ctx.stroke();

	if (xRange === null || !(xRange.max > xRange.min) || xTicks.length === 0) return;

	const plotWidth = plotRight - plotLeft;
	const xSpan = xRange.max - xRange.min;

	ctx.strokeStyle = theme.axisTick;
	ctx.beginPath();
	for (const tick of xTicks) {
		const x = Math.round(plotLeft + ((tick - xRange.min) / xSpan) * plotWidth) + 0.5;
		ctx.moveTo(x, baselineY);
		ctx.lineTo(x, baselineY + X_TICK_LENGTH);
	}
	ctx.stroke();

	ctx.font = `${AXIS_FONT_SIZE}px ${theme.fontFamily}`;
	ctx.fillStyle = theme.text;
	ctx.textBaseline = 'top';
	const labelY = plotBottom + X_LABEL_OFFSET;

	let lastRight = -Infinity;
	for (const tick of xTicks) {
		const label = formatAxisTime(tick, timeFormat);
		if (label.length === 0) continue;
		const x = plotLeft + ((tick - xRange.min) / xSpan) * plotWidth;
		const width = ctx.measureText(label).width;

		let align: CanvasTextAlign = 'center';
		let left = x - width / 2;
		if (x - plotLeft < EDGE_ANCHOR_PX || left < plotLeft) {
			align = 'left';
			left = x;
		} else if (plotRight - x < EDGE_ANCHOR_PX || left + width > plotRight) {
			align = 'right';
			left = x - width;
		}

		if (left < lastRight + X_LABEL_MIN_GAP) continue;
		ctx.textAlign = align;
		ctx.fillText(label, x, labelY);
		lastRight = left + width;
	}
}
