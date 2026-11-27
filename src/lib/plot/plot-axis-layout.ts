import type { PlotAxisRange } from '@/lib/plot/plot-viewport';

export const Y_AXIS_GUTTER = 64;

export const Y_TICK_COUNT = 5;

export const AXIS_FONT_SIZE = 12;

export type PlotGrid = { left: number; right: number; top: number; bottom: number };

const GRID_MARGINS = { right: 24, top: 18, bottom: 44 } as const;
const MAX_GENERATED_TICKS = 64;

export function plotGrid(axisCount: number): PlotGrid {
	return { ...GRID_MARGINS, left: Y_AXIS_GUTTER * Math.max(1, axisCount) };
}

export function axisGutterOffset(index: number, axisCount: number): number {
	return (Math.max(1, axisCount) - 1 - index) * Y_AXIS_GUTTER;
}

type AxisTick = { ratio: number; value: number };

/**
 * 1–2–5 × 10ⁿ nice-tick ladder clamped to `[domainMin, domainMax]`, matching ChartGPU's
 * value-axis ticks so DOM gutters and both renderers place gridlines at identical ratios.
 */
export function generateValueAxisTicks(
	domainMin: number,
	domainMax: number,
	tickCountHint = Y_TICK_COUNT
): number[] {
	if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) return [0, 1];
	const count = Math.max(2, Math.min(20, Math.floor(tickCountHint) || Y_TICK_COUNT));
	let min = domainMin;
	let max = domainMax;
	const degenerate = min === max;
	if (degenerate) {
		const pad = Math.abs(min) > 1e-6 ? Math.abs(min) * 0.1 : 0.5;
		min -= pad;
		max += pad;
	}
	if (min > max) [min, max] = [max, min];

	const step = niceStep((max - min) / (count - 1));
	if (!(step > 0) || !Number.isFinite(step)) return [min, max];

	const first = Math.floor(min / step) * step;
	const last = Math.ceil(max / step) * step;
	const epsilon = step * 1e-9;
	const clampMin = degenerate ? min : Math.min(domainMin, domainMax);
	const clampMax = degenerate ? max : Math.max(domainMin, domainMax);

	const ticks: number[] = [];
	let current = first;
	for (let i = 0; i < MAX_GENERATED_TICKS && current <= last + step * 0.5; i += 1) {
		const value = Math.abs(current) < step * 1e-12 ? 0 : current;
		if (
			value >= clampMin - epsilon &&
			value <= clampMax + epsilon &&
			(ticks.length === 0 || Math.abs(ticks[ticks.length - 1] - value) > epsilon)
		) {
			ticks.push(value);
		}
		current += step;
	}

	if (ticks.length >= 2) return ticks;
	return clampMin !== clampMax ? [clampMin, clampMax] : [min, max];
}

export function axisTicks(range: PlotAxisRange | null, count = Y_TICK_COUNT): AxisTick[] {
	if (range === null || count < 1) return [];
	const span = range.max - range.min;
	if (!(span > 0) || count === 1) return [{ ratio: 0.5, value: (range.min + range.max) / 2 }];

	return generateValueAxisTicks(range.min, range.max, count)
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

function niceStep(range: number): number {
	if (!(range > 0) || !Number.isFinite(range)) return 1;
	const exponent = Math.floor(Math.log10(range));
	const scale = 10 ** exponent;
	const fraction = range / scale;
	const niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
	return niceFraction * scale;
}
