import { describe, expect, it } from 'vitest';
import {
	boxViewport,
	fitDomain,
	panViewport,
	viewportIndicator,
	zoomViewport
} from './plot-viewport';

describe('plot viewport math', () => {
	it('fits finite points and pads the y axis', () => {
		expect(
			fitDomain([
				{ x: 0, y: 10 },
				{ x: 100, y: 20 },
				{ x: Number.NaN, y: 30 }
			])
		).toEqual({ xMin: 0, xMax: 100, yMin: 9.5, yMax: 20.5 });
	});

	it('pans in data units from pixel movement', () => {
		expect(
			panViewport(
				{ xMin: 0, xMax: 100, yMin: 0, yMax: 50 },
				{ x: 10, y: -20 },
				{ width: 100, height: 100 }
			)
		).toEqual({ xMin: -10, xMax: 90, yMin: -10, yMax: 40 });
	});

	it('zooms around the pointer anchor', () => {
		expect(
			zoomViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 }, 0.5, {
				xRatio: 0.25,
				yRatio: 0.75
			})
		).toEqual({ xMin: 12.5, xMax: 62.5, yMin: 12.5, yMax: 62.5 });
	});

	it('maps a selection box into data coordinates', () => {
		expect(
			boxViewport(
				{ xMin: 0, xMax: 100, yMin: 0, yMax: 200 },
				{ xRatio: 0.8, yRatio: 0.2 },
				{ xRatio: 0.2, yRatio: 0.7 }
			)
		).toEqual({ xMin: 20, xMax: 80, yMin: 60, yMax: 160 });
	});

	it('derives axis location indicators from full extent', () => {
		expect(
			viewportIndicator(
				{ xMin: 25, xMax: 75, yMin: 50, yMax: 150 },
				{ xMin: 0, xMax: 100, yMin: 0, yMax: 200 }
			)
		).toEqual({ xLeft: 25, xWidth: 50, yTop: 25, yHeight: 50 });
	});
});
