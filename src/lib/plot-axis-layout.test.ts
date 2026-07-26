import { describe, expect, it } from 'vitest';
import {
	axisGutterOffset,
	axisTicks,
	plotGrid,
	Y_AXIS_GUTTER,
	Y_TICK_COUNT
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
	it('walks the range top-down on the grid line rows', () => {
		expect(axisTicks({ min: 0, max: 100 }, 5)).toEqual([
			{ ratio: 0, value: 100 },
			{ ratio: 0.25, value: 75 },
			{ ratio: 0.5, value: 50 },
			{ ratio: 0.75, value: 25 },
			{ ratio: 1, value: 0 }
		]);
	});

	it('defaults to the grid line count and handles degenerate input', () => {
		expect(axisTicks({ min: 0, max: 1 })).toHaveLength(Y_TICK_COUNT);
		expect(axisTicks(null)).toEqual([]);
		expect(axisTicks({ min: 0, max: 1 }, 0)).toEqual([]);
		expect(axisTicks({ min: 5, max: 5 }, 1)).toEqual([{ ratio: 0.5, value: 5 }]);
	});
});
