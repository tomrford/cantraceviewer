import { describe, expect, it } from 'vitest';
import { moveCrosshair, type PlotCrosshair } from './plot-crosshair';

describe('plot crosshair movement', () => {
	it('moves both coordinates from the handle and one coordinate from each line', () => {
		const crosshair: PlotCrosshair = { id: 1, x: 10, y: 20 };
		const point = { x: 30, y: 40 };

		expect(moveCrosshair(crosshair, point, 'both')).toEqual({ id: 1, x: 30, y: 40 });
		expect(moveCrosshair(crosshair, point, 'x')).toEqual({ id: 1, x: 30, y: 20 });
		expect(moveCrosshair(crosshair, point, 'y')).toEqual({ id: 1, x: 10, y: 40 });
	});
});
