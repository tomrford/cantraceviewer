import type { PlotGrid } from './plot-axis-layout.js';

export type PlotRatioPoint = { xRatio: number; yRatio: number };

type PlotAreaRect = { left: number; top: number; width: number; height: number };

/** The plot area of `surface` in client coordinates: its bounding box less the grid margins. */
export function plotAreaRect(surface: HTMLElement, grid: PlotGrid): PlotAreaRect {
	const rect = surface.getBoundingClientRect();
	return {
		left: rect.left + grid.left,
		top: rect.top + grid.top,
		width: rect.width - grid.left - grid.right,
		height: rect.height - grid.top - grid.bottom
	};
}

/** A client point as 0..1 ratios of `area`, clamped to its edges; null while it has no size. */
export function ratioInArea(
	area: PlotAreaRect,
	point: { clientX: number; clientY: number }
): PlotRatioPoint | null {
	if (!(area.width > 0) || !(area.height > 0)) return null;
	return {
		xRatio: clamp((point.clientX - area.left) / area.width),
		yRatio: clamp((point.clientY - area.top) / area.height)
	};
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}
