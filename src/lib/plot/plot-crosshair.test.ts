import { describe, expect, it } from 'vitest';

import { moveCrosshair, type PlotCrosshair } from '@/lib/plot/plot-crosshair';

describe('plot crosshair movement', () => {
	it('moves both coordinates from the handle and one coordinate from each line', () => {
		const crosshair: PlotCrosshair = { id: 1, x: 10, fitY: 0.2 };
		const point = { x: 30, fitY: 0.4 };

		expect(moveCrosshair(crosshair, point, 'both')).toEqual({ id: 1, x: 30, fitY: 0.4 });
		expect(moveCrosshair(crosshair, point, 'x')).toEqual({ id: 1, x: 30, fitY: 0.2 });
		expect(moveCrosshair(crosshair, point, 'y')).toEqual({ id: 1, x: 10, fitY: 0.4 });
	});
});
