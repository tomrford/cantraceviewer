import { describe, expect, it } from 'vitest';
import {
	createSignalViewCache,
	formatAxisValue,
	formatDecodedValue,
	formatLegendNumericValue,
	isOutsideDbcRange,
	lineSeries,
	lineSeriesForViews,
	signalDomain,
	visibleSignalViews,
	visibleViewsEqual,
	type SignalView
} from './signal-plot-data';
import type { PlotSignal } from './stores/plot-data.svelte.js';

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
		minimum: 0,
		maximum: 0,
		valueDescriptions: []
	};
}

const formatContext = {
	unit: 'km/h',
	factor: 0.1,
	offset: 0,
	minimum: 0,
	maximum: 250,
	valueDescriptions: [] as { rawValue: number; label: string }[]
};

describe('signal plot data', () => {
	it('includes neighboring points at viewport edges for line continuity', () => {
		const [visible] = visibleSignalViews([view([0, 10, 20, 30, 40], [1, 2, 3, 4, 5])], {
			xMin: 10,
			xMax: 30
		});

		expect(Array.from(visible.x)).toEqual([0, 10, 20, 30, 40]);
		expect(Array.from(visible.y)).toEqual([1, 2, 3, 4, 5]);
		expect(visible.points).toBe(5);
	});

	it('includes bracketing samples when a line segment crosses an empty viewport', () => {
		const [visible] = visibleSignalViews([view([0, 10, 20], [1, 2, 3])], {
			xMin: 12,
			xMax: 18
		});

		expect(Array.from(visible.x)).toEqual([10, 20]);
		expect(Array.from(visible.y)).toEqual([2, 3]);
		expect(visible.points).toBe(2);
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

	it('flags values outside specified DBC limits, treating [0|0] as unspecified', () => {
		expect(isOutsideDbcRange(251, 0, 250)).toBe(true);
		expect(isOutsideDbcRange(250, 0, 250)).toBe(false);
		expect(isOutsideDbcRange(999, 0, 0)).toBe(false);
	});

	it('caps legend numeric width at seven significant digits', () => {
		expect(formatLegendNumericValue(12345.678, 1)).toBe('12346');
		expect(formatLegendNumericValue(12.34567, 0.01)).toBe('12.35');
		expect(formatLegendNumericValue(0.1234567, 0.0001)).toBe('0.1235');
	});

	it('pads legend decimals to the chosen resolution', () => {
		expect(formatLegendNumericValue(12, 0.01)).toBe('12.00');
		expect(formatLegendNumericValue(300, 0.1)).toBe('300.0');
	});

	it('preserves fractional offsets in legend values', () => {
		expect(formatLegendNumericValue(12.5, 1, 0.5)).toBe('12.5');
		expect(
			formatDecodedValue(12.5, {
				...formatContext,
				factor: 1,
				offset: 0.5
			})
		).toEqual({
			text: '12.5 km/h',
			outOfRange: false
		});
	});

	it('preserves nonzero tiny legend values', () => {
		expect(formatLegendNumericValue(1e-13, 1e-13)).toBe('1.000000e-13');
		expect(formatLegendNumericValue(0, 1e-13)).toBe('0');
		expect(formatLegendNumericValue(-0, 1e-13)).toBe('0');
	});

	it('does not flag float noise at DBC range boundaries', () => {
		// 3 * 0.1 === 0.30000000000000004; the displayed 0.3 is exactly at the limit.
		expect(formatDecodedValue(3 * 0.1, { ...formatContext, maximum: 0.3 })).toEqual({
			text: '0.3 km/h',
			outOfRange: false
		});
	});

	it('formats decoded legend values with units and out-of-range state', () => {
		expect(formatDecodedValue(42.37, formatContext)).toEqual({
			text: '42.4 km/h',
			outOfRange: false
		});
		expect(formatDecodedValue(300, formatContext)).toEqual({
			text: '300.0 km/h',
			outOfRange: true
		});
		expect(formatDecodedValue(42.37, { ...formatContext, minimum: 0, maximum: 0 })).toEqual({
			text: '42.4 km/h',
			outOfRange: false
		});
	});
});

// Value descriptions come identity-stable from the DBC catalog in the app.
const NO_DESCRIPTIONS: PlotSignal['valueDescriptions'] = [];

function plotSignal(overrides: Partial<PlotSignal> = {}): PlotSignal {
	return {
		key: 'dbc:Message.Signal',
		color: '#fff',
		dbcFileId: 'dbc',
		dbcName: 'demo',
		sourceFileName: 'demo.dbc',
		messageName: 'Message',
		signalName: 'Signal',
		label: 'Message.Signal',
		canId: 1,
		dbcId: 1,
		isExtended: false,
		isFd: false,
		sizeBytes: 8,
		transmitter: '',
		startBit: 0,
		bitLength: 8,
		endianness: 'little',
		signedness: 'unsigned',
		factor: 1,
		offset: 0,
		minimum: 0,
		maximum: 0,
		unit: '',
		valueType: 'unsigned',
		receivers: [],
		valueDescriptions: NO_DESCRIPTIONS,
		series: { timesMs: new Float64Array([0, 1]), values: new Float64Array([2, 3]) },
		isDecoding: false,
		decodeError: null,
		...overrides
	};
}

describe('createSignalViewCache', () => {
	it('reuses a view when the signal is rebuilt with unchanged content', () => {
		const cache = createSignalViewCache();
		const series = { timesMs: new Float64Array([0, 1]), values: new Float64Array([2, 3]) };
		const [first] = cache([plotSignal({ series })]);
		const [second] = cache([plotSignal({ series, isDecoding: true })]);

		expect(second).toBe(first);
	});

	it('rebuilds the view when the series is replaced, even at equal length', () => {
		const cache = createSignalViewCache();
		const [first] = cache([plotSignal()]);
		const [second] = cache([
			plotSignal({
				series: { timesMs: new Float64Array([0, 1]), values: new Float64Array([2, 3]) }
			})
		]);

		expect(second).not.toBe(first);
	});

	it('rebuilds the view when the color changes', () => {
		const cache = createSignalViewCache();
		const [first] = cache([plotSignal()]);
		const [second] = cache([plotSignal({ color: '#f00' })]);

		expect(second).not.toBe(first);
	});
});

describe('visibleViewsEqual', () => {
	const source = view([0, 10, 20, 30, 40], [1, 2, 3, 4, 5]);

	it('treats recomputed slices over the same window as equal', () => {
		const a = visibleSignalViews([source], { xMin: 19, xMax: 21 });
		const b = visibleSignalViews([source], { xMin: 19, xMax: 21 });

		expect(a[0]).not.toBe(b[0]);
		expect(a[0].x).not.toBe(b[0].x);
		expect(visibleViewsEqual(a, b)).toBe(true);
	});

	it('detects a shifted window over the same data', () => {
		const a = visibleSignalViews([source], { xMin: 10, xMax: 30 });
		const b = visibleSignalViews([source], { xMin: 20, xMax: 40 });

		expect(visibleViewsEqual(a, b)).toBe(false);
	});

	it('detects view list changes', () => {
		const a = visibleSignalViews([source], null);
		expect(visibleViewsEqual(a, [])).toBe(false);
		expect(visibleViewsEqual(a, visibleSignalViews([{ ...source, color: '#f00' }], null))).toBe(
			false
		);
	});
});
