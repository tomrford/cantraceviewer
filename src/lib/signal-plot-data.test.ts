import { describe, expect, it } from 'vitest';
import {
	lineSeries,
	lineSeriesForViews,
	visibleSignalViews,
	type SignalView
} from './signal-plot-data';

function view(x: number[], y: number[] = x): SignalView {
	return {
		key: 'signal',
		label: 'Signal',
		unit: '',
		color: '#fff',
		x: new Float64Array(x),
		y: new Float64Array(y),
		points: x.length,
		latestText: '-',
		factor: 1,
		offset: 0,
		valueDescriptions: []
	};
}

describe('signal plot data', () => {
	it('keeps line data constrained to the active x viewport', () => {
		const [visible] = visibleSignalViews([view([0, 10, 20, 30, 40], [1, 2, 3, 4, 5])], {
			xMin: 10,
			xMax: 30
		});

		expect(Array.from(visible.x)).toEqual([10, 20, 30]);
		expect(Array.from(visible.y)).toEqual([2, 3, 4]);
		expect(visible.points).toBe(3);
	});

	it('returns empty line data when no points are in the viewport', () => {
		const [visible] = visibleSignalViews([view([0, 10, 20])], {
			xMin: 30,
			xMax: 40
		});

		expect(Array.from(visible.x)).toEqual([]);
		expect(Array.from(visible.y)).toEqual([]);
		expect(visible.points).toBe(0);
	});

	it('splits the sampling threshold across visible lines', () => {
		const series = lineSeries(view([0, 1]), 10);

		expect(series.type).toBe('line');
		if (series.type !== 'line') throw new Error('expected line series');
		expect(series.samplingThreshold).toBe(2500);
	});

	it('excludes empty lines from the sampling budget split', () => {
		const [series] = lineSeriesForViews([view([]), view([0, 1]), view([])]);

		expect(series.type).toBe('line');
		if (series.type !== 'line') throw new Error('expected line series');
		expect(series.samplingThreshold).toBe(25_000);
	});
});
