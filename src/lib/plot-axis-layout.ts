import type { PlotAxisRange } from './plot-viewport.js';

/** Width of one y axis gutter in CSS pixels. */
export const Y_AXIS_GUTTER = 64;

/** Preferred number of y tick labels and horizontal grid lines. */
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
export type AxisTickGenerator = (min: number, max: number, count: number) => number[];

/** Primary-axis tick rows, using the same nice-tick generator as ChartGPU. */
export function axisTicks(
	range: PlotAxisRange | null,
	generateTicks: AxisTickGenerator,
	count = Y_TICK_COUNT
): AxisTick[] {
	if (range === null || count < 1) return [];
	const span = range.max - range.min;
	if (!(span > 0) || count === 1) return [{ ratio: 0.5, value: (range.min + range.max) / 2 }];

	return generateTicks(range.min, range.max, count)
		.map((value) => ({ ratio: (range.max - value) / span, value }))
		.reverse();
}

/** Secondary-axis values at the primary axis's shared horizontal grid rows. */
export function axisTicksAtRatios(
	range: PlotAxisRange | null,
	ratios: readonly number[]
): AxisTick[] {
	if (range === null) return [];
	const span = range.max - range.min;
	return ratios.map((ratio) => ({ ratio, value: range.max - ratio * span }));
}
