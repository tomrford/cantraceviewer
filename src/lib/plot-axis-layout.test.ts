import { describe, expect, it } from 'vitest';
import { generateValueAxisTicks } from 'chartgpu';
import {
	axisGutterOffset,
	axisTicks,
	axisTicksAtRatios,
	plotGrid,
	Y_AXIS_GUTTER
} from './plot-axis-layout.js';

describe('plotGrid', () => {
	it('reserves one gutter per axis and leaves the other margins alone', () => {
		expect(plotGrid(1)).toEqual({ left: Y_AXIS_GUTTER, right: 24, top: 18, bottom: 44 });
		expect(plotGrid(3).left).toBe(Y_AXIS_GUTTER * 3);
	});

	it('never collapses the left margin when no axes are reported', () => {
		expect(plotGrid(0).left).toBe(Y_AXIS_GUTTER);
	});
});

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
		const ticks = axisTicks({ min: 11.3, max: 38.8 }, generateValueAxisTicks, 5);
		expect(ticks.map((tick) => tick.value)).toEqual([35, 30, 25, 20, 15]);
		ticks.forEach((tick) => {
			expect(tick.ratio).toBeCloseTo((38.8 - tick.value) / 27.5);
		});
	});

	it('uses the default tick hint and handles degenerate input', () => {
		const ticks = axisTicks({ min: 0, max: 1 }, generateValueAxisTicks);
		expect(ticks).toHaveLength(6);
		ticks.forEach((tick, index) => expect(tick.value).toBeCloseTo(1 - index * 0.2));
		expect(axisTicks(null, generateValueAxisTicks)).toEqual([]);
		expect(axisTicks({ min: 0, max: 1 }, generateValueAxisTicks, 0)).toEqual([]);
		expect(axisTicks({ min: 5, max: 5 }, generateValueAxisTicks, 1)).toEqual([
			{ ratio: 0.5, value: 5 }
		]);
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
