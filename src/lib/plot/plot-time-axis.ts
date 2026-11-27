/*!
 * MIT License
 *
 * Copyright (c) 2026 ChartGPU
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { PlotAxisRange } from '@/lib/plot/plot-viewport';

const DAY_MS = 86_400_000;
const MAX_TICKS = 9;
export const TIME_LABEL_GAP_PX = 6;

// Time steps used by ChartGPU 0.4.0's adaptive X axis. Keep Canvas on the same
// ladder without loading ChartGPU, whose time tick generator is internal.
// https://github.com/chartgpu/chartgpu/blob/v0.4.0/src/core/renderCoordinator/utils/timeAxisUtils.ts
const STEPS_MS = [
	1,
	2,
	5,
	10,
	20,
	50,
	100,
	200,
	500,
	1_000,
	2_000,
	5_000,
	10_000,
	15_000,
	30_000,
	60_000,
	120_000,
	300_000,
	600_000,
	900_000,
	1_800_000,
	3_600_000,
	7_200_000,
	10_800_000,
	21_600_000,
	43_200_000,
	DAY_MS,
	2 * DAY_MS,
	7 * DAY_MS,
	14 * DAY_MS,
	30 * DAY_MS,
	90 * DAY_MS,
	365 * DAY_MS
];

export function timeAxisTicks(
	{ min, max }: PlotAxisRange,
	plotWidth: number,
	measureLabel: (value: number) => number
): number[] {
	const span = max - min;
	if (!Number.isFinite(span) || span <= 0) return [];

	const widths = new Map<number, number>();
	function labelsFit(ticks: readonly number[]): boolean {
		let previousRight = -Infinity;
		for (const [index, value] of ticks.entries()) {
			let width = widths.get(value);
			if (width === undefined) {
				width = measureLabel(value);
				widths.set(value, width);
			}
			const x = ((value - min) / span) * plotWidth;
			let left = x - width / 2;
			if (ticks.length > 1 && index === 0) left = x;
			if (ticks.length > 1 && index === ticks.length - 1) left = x - width;
			if (left < previousRight + TIME_LABEL_GAP_PX) return false;
			previousRight = left + width;
		}
		return true;
	}

	let previous = '';
	for (let target = MAX_TICKS; target >= 1; target -= 1) {
		const ticks = ticksForTarget(min, max, target);
		const key = ticks.join(',');
		if (key === previous) continue;
		previous = key;
		// Try the full set, then every second or third tick before spacing the base ticks further apart.
		const maxStride = Math.min(3, Math.max(1, ticks.length - 1));
		for (let stride = 1; stride <= maxStride; stride += 1) {
			const candidate = stride === 1 ? ticks : ticks.filter((_, index) => index % stride === 0);
			if (labelsFit(candidate)) return candidate;
		}
	}
	return ticksForTarget(min, max, 1);
}

function ticksForTarget(min: number, max: number, target: number): number[] {
	const idealStep = (max - min) / Math.max(1, target - 1);
	for (const [index, step] of STEPS_MS.entries()) {
		const lastStep = index === STEPS_MS.length - 1;
		if (!lastStep && step < idealStep) continue;
		let first = Math.ceil(min / step) * step;
		if (first < min) first += step;
		if (first > max) break;
		const count = Math.floor((max - first) / step) + 1;
		if (!lastStep && count > MAX_TICKS) continue;
		const stride = Math.ceil(count / MAX_TICKS);
		return Array.from(
			{ length: Math.ceil(count / stride) },
			(_, index) => first + index * stride * step
		);
	}
	return [min, max];
}
