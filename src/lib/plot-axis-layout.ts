import type { PlotAxisRange } from './plot-viewport.js';

export const Y_AXIS_GUTTER = 64;

export const Y_TICK_COUNT = 5;

export type PlotGrid = { left: number; right: number; top: number; bottom: number };

const GRID_MARGINS = { right: 24, top: 18, bottom: 44 } as const;

export function plotGrid(axisCount: number): PlotGrid {
	return { ...GRID_MARGINS, left: Y_AXIS_GUTTER * Math.max(1, axisCount) };
}

export function axisGutterOffset(index: number, axisCount: number): number {
	return (Math.max(1, axisCount) - 1 - index) * Y_AXIS_GUTTER;
}

export type AxisTick = { ratio: number; value: number };
export type AxisTickGenerator = (min: number, max: number, count: number) => number[];

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

export function axisTicksAtRatios(
	range: PlotAxisRange | null,
	ratios: readonly number[]
): AxisTick[] {
	if (range === null) return [];
	const span = range.max - range.min;
	return ratios.map((ratio) => ({ ratio, value: range.max - ratio * span }));
}
