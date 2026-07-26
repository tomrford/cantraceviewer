import { describe, expect, it } from 'vitest';
import {
	groupSignalsByYAxis,
	nextYAxisId,
	PRIMARY_Y_AXIS_ID,
	yAxisLabel,
	yAxisUnit
} from './plot-axes.js';

function signal(key: string, unit = '') {
	return { key, unit };
}

describe('nextYAxisId', () => {
	it('never reuses a live id after axes are removed out of order', () => {
		expect(nextYAxisId(['y'])).toBe('y1');
		// 'y1' was removed, so the length-derived candidate collides with 'y2'.
		expect(nextYAxisId(['y', 'y2'])).toBe('y3');
	});
});

describe('groupSignalsByYAxis', () => {
	it('keeps unassigned signals on the primary axis in order', () => {
		const groups = groupSignalsByYAxis(
			[signal('a'), signal('b')],
			[PRIMARY_Y_AXIS_ID, 'y1'],
			new Map()
		);

		expect(groups.map((group) => group.signals.map((s) => s.key))).toEqual([['a', 'b'], []]);
		expect(groups.map((group) => group.index)).toEqual([0, 1]);
	});

	it('splits signals across their assigned axes', () => {
		const groups = groupSignalsByYAxis(
			[signal('a'), signal('b'), signal('c')],
			[PRIMARY_Y_AXIS_ID, 'y1'],
			new Map([
				['b', 'y1'],
				['c', 'y1']
			])
		);

		expect(groups.map((group) => group.signals.map((s) => s.key))).toEqual([['a'], ['b', 'c']]);
	});

	it('falls back to the primary axis when an assignment names a removed axis', () => {
		const groups = groupSignalsByYAxis([signal('a')], [PRIMARY_Y_AXIS_ID], new Map([['a', 'y9']]));

		expect(groups[0].signals.map((s) => s.key)).toEqual(['a']);
	});
});

describe('yAxisUnit', () => {
	it('reports the unit only when every signal that has one agrees', () => {
		expect(yAxisUnit([signal('a', 'km/h'), signal('b', 'km/h')])).toBe('km/h');
		expect(yAxisUnit([signal('a', 'km/h'), signal('b', '')])).toBe('km/h');
		expect(yAxisUnit([signal('a', 'km/h'), signal('b', 'degC')])).toBeNull();
		expect(yAxisUnit([])).toBeNull();
	});
});

describe('yAxisLabel', () => {
	it('numbers axes from one and appends a shared unit', () => {
		expect(yAxisLabel(0, null)).toBe('Y1');
		expect(yAxisLabel(1, 'degC')).toBe('Y2 · degC');
	});
});
