import { describe, expect, it } from 'vitest';
import {
	createSignalViewCache,
	crosshairDeltaValue,
	crosshairValue,
	emptyAxisSeries,
	formatAxisValue,
	formatDecodedValue,
	formatLegendNumericValue,
	formatTimeDelta,
	isOutsideDbcRange,
	lineSeries,
	plotSeriesForViews,
	renderIndexRange,
	signalDomain,
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
	it('includes neighboring indexes at window edges for line continuity', () => {
		expect(renderIndexRange(new Float64Array([0, 10, 20, 30, 40]), 10, 30)).toEqual({
			start: 0,
			end: 5
		});
	});

	it('brackets a line segment crossing an empty window', () => {
		expect(renderIndexRange(new Float64Array([0, 10, 20]), 12, 18)).toEqual({
			start: 1,
			end: 3
		});
	});

	it('returns an empty range for windows beyond the data', () => {
		expect(renderIndexRange(new Float64Array([0, 10, 20]), 30, 40)).toEqual({
			start: 3,
			end: 3
		});
	});

	it('disables chart-side sampling for lines', () => {
		const full = lineSeries({ ...view([0, 1, 2]), sampled: false }, 'y');
		expect(full.sampling).toBe('none');
	});

	it('adds sample markers only to full-resolution views', () => {
		const fullView = { ...view([0, 1, 2]), sampled: false };
		const downsampledView = { ...view([0, 1, 2]), sampled: true };
		const series = plotSeriesForViews([fullView, downsampledView], () => 'y');

		expect(series.map((entry) => entry.type)).toEqual(['line', 'scatter', 'line']);
		const marker = series[1];
		expect(marker).toMatchObject({
			type: 'scatter',
			data: { x: fullView.x, y: fullView.y },
			symbolSize: 1.5,
			sampling: 'none'
		});
	});

	it('excludes empty views from the chart series', () => {
		const series = plotSeriesForViews(
			[
				{ ...view([]), sampled: false },
				{ ...view([0, 1]), sampled: false }
			],
			() => 'y'
		);

		expect(series.map((entry) => entry.type)).toEqual(['line', 'scatter']);
	});

	it('routes each signal series to its assigned y axis', () => {
		const first = { ...view([0, 1]), key: 'a', sampled: false };
		const second = { ...view([0, 1]), key: 'b', sampled: false };
		const series = plotSeriesForViews([first, second], (candidate) =>
			candidate.key === 'b' ? 'y1' : 'y'
		);

		expect(series.map((entry) => entry.yAxis)).toEqual(['y', 'y', 'y1', 'y1']);
	});

	it('keeps explicit axes alive with an invisible empty line', () => {
		const series = emptyAxisSeries('y2');
		expect(series).toMatchObject({
			type: 'line',
			yAxis: 'y2',
			visible: false,
			sampling: 'none'
		});
		const data = series.data as { x: Float64Array; y: Float64Array };
		expect(data.x).toHaveLength(0);
		expect(data.y).toHaveLength(0);
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

	it('calculates signal deltas from the samples nearest each crosshair', () => {
		const signal = {
			...view([0, 10, 20], [5, 10, 25]),
			unit: 'V',
			factor: 0.1
		};

		expect(crosshairValue(signal, 9)).toEqual({
			key: 'signal',
			text: '10.0 V',
			outOfRange: false
		});
		expect(crosshairDeltaValue(signal, 9, 19)).toEqual({
			key: 'signal',
			text: '15.0 V',
			outOfRange: false
		});
	});

	it('does not calculate numeric deltas for enumerated signals', () => {
		const signal = {
			...view([0, 10], [0, 1]),
			valueDescriptions: [
				{ rawValue: 0, label: 'Off' },
				{ rawValue: 1, label: 'On' }
			]
		};

		expect(crosshairDeltaValue(signal, 0, 10)).toEqual({
			key: 'signal',
			text: 'N/A',
			outOfRange: false
		});
	});

	it('formats signed crosshair time deltas as durations', () => {
		expect(formatTimeDelta(1234)).toBe('1.234s');
		expect(formatTimeDelta(-61_250)).toBe('-1m 1.250s');
	});
});

// Value descriptions come identity-stable from the DBC catalog in the app.
const NO_DESCRIPTIONS: PlotSignal['valueDescriptions'] = [];

function plotSignal(overrides: Partial<PlotSignal> = {}): PlotSignal {
	return {
		key: 'dbc:Message.Signal',
		color: '#fff',
		messageName: 'Message',
		signalName: 'Signal',
		label: 'Message.Signal',
		factor: 1,
		offset: 0,
		minimum: 0,
		maximum: 0,
		unit: '',
		valueDescriptions: NO_DESCRIPTIONS,
		series: { timesMs: new Float64Array([0, 1]), values: new Float64Array([2, 3]) },
		...overrides
	};
}

describe('createSignalViewCache', () => {
	it('reuses a view when the signal is rebuilt with unchanged content', () => {
		const cache = createSignalViewCache();
		const series = { timesMs: new Float64Array([0, 1]), values: new Float64Array([2, 3]) };
		const [first] = cache([plotSignal({ series })]);
		const [second] = cache([plotSignal({ series })]);

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
