import { describe, expect, it } from 'vitest';

import { nextSignalColorIndex, signalColor, SIGNAL_COLORS } from '@/lib/plot/plot-colors';

describe('signal colours', () => {
	it('takes the lowest index that is not already taken', () => {
		expect(nextSignalColorIndex([])).toBe(0);
		expect(nextSignalColorIndex([0])).toBe(1);
		expect(nextSignalColorIndex([0, 1])).toBe(2);
		expect(nextSignalColorIndex([0, 2])).toBe(1);
	});

	it('wraps round the palette once every colour is taken', () => {
		const everyColor = SIGNAL_COLORS.map((_, index) => index);

		expect(nextSignalColorIndex(everyColor)).toBe(SIGNAL_COLORS.length);
		expect(signalColor(SIGNAL_COLORS.length)).toBe(SIGNAL_COLORS[0]);
	});
});
