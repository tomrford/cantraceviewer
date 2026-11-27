import { generateValueAxisTicks as chartGpuValueAxisTicks } from 'chartgpu';
import { describe, expect, it } from 'vitest';

import {
	axisGutterOffset,
	axisTicks,
	axisTicksAtRatios,
	generateValueAxisTicks,
	Y_AXIS_GUTTER
} from '@/lib/plot/plot-axis-layout';

describe('axisGutterOffset', () => {
	it('places the primary axis innermost and stacks later axes outwards', () => {
		expect(axisGutterOffset(0, 1)).toBe(0);
		expect(axisGutterOffset(0, 3)).toBe(Y_AXIS_GUTTER * 2);
		expect(axisGutterOffset(1, 3)).toBe(Y_AXIS_GUTTER);
		expect(axisGutterOffset(2, 3)).toBe(0);
	});
});

describe('axisTicks', () => {
	it('matches ChartGPU nice ticks and walks them top-down', () => {
		const ticks = axisTicks({ min: 11.3, max: 38.8 }, 5);
		expect(ticks.map((tick) => tick.value)).toEqual([35, 30, 25, 20, 15]);
		ticks.forEach((tick) => {
			expect(tick.ratio).toBeCloseTo((38.8 - tick.value) / 27.5);
		});
	});

	it('uses the default tick hint and handles degenerate input', () => {
		const ticks = axisTicks({ min: 0, max: 1 });
		expect(ticks).toHaveLength(6);
		ticks.forEach((tick, index) => expect(tick.value).toBeCloseTo(1 - index * 0.2));
		expect(axisTicks(null)).toEqual([]);
		expect(axisTicks({ min: 0, max: 1 }, 0)).toEqual([]);
		expect(axisTicks({ min: 5, max: 5 }, 1)).toEqual([{ ratio: 0.5, value: 5 }]);
	});

	it('produces the same clamped tick ladder as ChartGPU across scales and edge ranges', () => {
		for (const [min, max, count] of [
			[0, 100, 5],
			[-42.7, 18.3, 5],
			[11.3, 38.8, 5],
			[0.0012, 0.0087, 5],
			[100_000, 950_000, 6],
			[42, 42, 5],
			[0, 0, 5]
		] as const) {
			const actual = generateValueAxisTicks(min, max, count);
			const expected = chartGpuValueAxisTicks(min, max, count);
			expect(actual).toHaveLength(expected.length);
			actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 10));
		}
	});
});

describe('axisTicksAtRatios', () => {
	it('maps a secondary range onto the primary grid rows', () => {
		expect(axisTicksAtRatios({ min: 0, max: 200 }, [0.2, 0.6])).toEqual([
			{ ratio: 0.2, value: 160 },
			{ ratio: 0.6, value: 80 }
		]);
	});
});
