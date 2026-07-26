import type { PlotAxisRange } from './plot-viewport.js';

/** Width of one y axis gutter in CSS pixels. */
export const Y_AXIS_GUTTER = 64;

/**
 * Rows of y tick labels. ChartGPU draws its horizontal grid lines at
 * `i / (count - 1)` across the plot area with the same default count, so
 * matching it here keeps every axis's labels sitting on the grid lines.
 */
export const Y_TICK_COUNT = 5;

export type PlotGrid = { left: number; right: number; top: number; bottom: number };

const GRID_MARGINS = { right: 24, top: 18, bottom: 44 } as const;

/** Plot margins for a given axis count. One axis reproduces the original grid. */
export function plotGrid(axisCount: number): PlotGrid {
	return { ...GRID_MARGINS, left: Y_AXIS_GUTTER * Math.max(1, axisCount) };
}

/**
 * Offset in CSS pixels from the plot's left edge to this axis gutter's left
 * edge. Axis 0 sits innermost against the plot area and later axes stack
 * outwards to the left.
 */
export function axisGutterOffset(index: number, axisCount: number): number {
	return (Math.max(1, axisCount) - 1 - index) * Y_AXIS_GUTTER;
}

export type AxisTick = { ratio: number; value: number };

/** Tick rows top-down: ratio 0 is the top of the plot area, 1 the bottom. */
export function axisTicks(range: PlotAxisRange | null, count = Y_TICK_COUNT): AxisTick[] {
	if (range === null || count < 1) return [];
	const span = range.max - range.min;

	return Array.from({ length: count }, (_, index) => {
		const ratio = count === 1 ? 0.5 : index / (count - 1);
		return { ratio, value: range.max - ratio * span };
	});
}
