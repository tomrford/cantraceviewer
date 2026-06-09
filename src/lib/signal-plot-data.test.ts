import { describe, expect, it } from 'vitest';
import {
	formatAxisValue,
	lineSeries,
	lineSeriesForViews,
	signalDomain,
	visibleSignalViews,
	type SignalView
} from './signal-plot-data';

function view(x: number[], y: number[] = x): SignalView {
	return {
		key: 'signal',
		label: 'Signal',
		messageName: 'Message',
		signalName: 'Signal',
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

	it('fits the domain across views from min/max scans', () => {
		expect(signalDomain([view([0, 50, 100], [10, 15, 20]), view([25, 75], [-10, 0])])).toEqual({
			xMin: 0,
			xMax: 100,
			yMin: -11.5,
			yMax: 21.5
		});
	});

	it('fits x domain from min/max scan when timestamps are non-monotonic', () => {
		expect(signalDomain([view([5, 1, 9, 3], [10, 20, 30, 40])])).toEqual({
			xMin: 1,
			xMax: 9,
			yMin: 8.5,
			yMax: 41.5
		});
	});

	it('skips samples with non-finite coordinates', () => {
		expect(
			signalDomain([view([Number.NaN, 10, 20, 30], [5, 10, Number.POSITIVE_INFINITY, 20])])
		).toEqual({ xMin: 10, xMax: 30, yMin: 9.5, yMax: 20.5 });
	});

	it('returns null when no view has finite points', () => {
		expect(signalDomain([])).toBeNull();
		expect(signalDomain([view([])])).toBeNull();
		expect(signalDomain([view([0, 1], [Number.NaN, Number.NaN])])).toBeNull();
	});

	it('recomputes the domain when the value series changes for the same time series', () => {
		const x = new Float64Array([0, 100]);
		const base = view([], []);
		const first = { ...base, x, y: new Float64Array([0, 10]), points: 2 };
		const second = { ...base, x, y: new Float64Array([0, 40]), points: 2 };

		expect(signalDomain([first])).toEqual({ xMin: 0, xMax: 100, yMin: -0.5, yMax: 10.5 });
		expect(signalDomain([second])).toEqual({ xMin: 0, xMax: 100, yMin: -2, yMax: 42 });
	});

	it('keeps y-axis tick labels compact', () => {
		expect(formatAxisValue(123.456789)).toBe('123');
		expect(formatAxisValue(12.3456789)).toBe('12.3');
		expect(formatAxisValue(1.23456789)).toBe('1.235');
		expect(formatAxisValue(0.000012345)).toBe('1.23e-5');
	});
});
