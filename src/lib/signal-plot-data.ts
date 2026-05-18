import type { SeriesConfig } from 'chartgpu';
import { fitDomain, type PlotPoint, type PlotViewport } from './plot-viewport';
import type { PlotSignal } from './stores/plot-data.svelte.js';
import type { TimestampMode } from './stores/preferences.svelte.js';

export type SignalView = {
	key: string;
	label: string;
	unit: string;
	color: string;
	x: Float64Array;
	y: Float64Array;
	points: number;
	latestText: string;
	factor: number;
	offset: number;
	valueDescriptions: PlotSignal['valueDescriptions'];
};

export type VisibleSignalView = SignalView & {
	x: Float64Array<ArrayBufferLike>;
	y: Float64Array<ArrayBufferLike>;
};

const DEFAULT_TOTAL_SAMPLING_THRESHOLD = 25_000;

export function signalView(signal: PlotSignal): SignalView {
	const series = signal.series;
	const sourceTimes = series?.timesMs ?? new Float64Array(0);
	const sourceValues = series?.values ?? new Float64Array(0);

	return {
		key: signal.key,
		label: signal.label,
		unit: signal.unit,
		color: signal.color,
		x: sourceTimes,
		y: sourceValues,
		points: sourceTimes.length,
		latestText: formatDecodedValue(sourceValues.at(-1) ?? null, signal),
		factor: signal.factor,
		offset: signal.offset,
		valueDescriptions: signal.valueDescriptions
	};
}

export function visibleSignalViews(
	views: SignalView[],
	viewport: Pick<PlotViewport, 'xMin' | 'xMax'> | null
): VisibleSignalView[] {
	if (viewport === null) return views;

	return views.map((view) => {
		const { start, end } = visibleIndexRange(view.x, viewport.xMin, viewport.xMax);
		if (start === 0 && end === view.points) return view;
		return {
			...view,
			x: view.x.subarray(start, end),
			y: view.y.subarray(start, end),
			points: end - start
		};
	});
}

export function lineSeries(
	view: SignalView,
	visibleLineCount = 1,
	totalSamplingThreshold = DEFAULT_TOTAL_SAMPLING_THRESHOLD
): SeriesConfig {
	const samplingThreshold = Math.max(
		2,
		Math.floor(totalSamplingThreshold / Math.max(1, visibleLineCount))
	);

	return {
		type: 'line',
		name: view.label,
		data: { x: view.x, y: view.y },
		color: view.color,
		lineStyle: { color: view.color, width: 1.5, opacity: 0.95 },
		sampling: 'lttb',
		samplingThreshold
	};
}

export function lineSeriesForViews(views: SignalView[]): SeriesConfig[] {
	const plottedViews = views.filter((view) => view.points > 0);
	return plottedViews.map((view) => lineSeries(view, plottedViews.length));
}

export function markerValue(view: SignalView, x: number) {
	return {
		key: view.key,
		text: formatDecodedValue(nearestValue(view, x), view)
	};
}

export function signalDomain(views: SignalView[]): PlotViewport | null {
	return fitDomain(plotPoints(views));
}

export function formatAxisTime(
	value: number,
	options: { measurementStartMs?: number | null; mode: TimestampMode }
): string {
	if (!Number.isFinite(value)) return '';
	if (
		options.mode === 'absolute' &&
		options.measurementStartMs !== null &&
		options.measurementStartMs !== undefined
	) {
		const date = new Date(options.measurementStartMs + value);
		return date.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3
		});
	}

	const seconds = value / 1000;
	if (seconds < 60) return `${seconds.toFixed(3)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${(seconds - minutes * 60).toFixed(3)}s`;
}

function* plotPoints(views: SignalView[]): Iterable<PlotPoint> {
	for (const view of views) {
		for (let index = 0; index < view.points; index += 1) {
			yield { x: view.x[index], y: view.y[index] };
		}
	}
}

function nearestValue(view: SignalView, x: number): number | null {
	if (view.points === 0) return null;
	let low = 0;
	let high = view.points - 1;

	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (view.x[mid] < x) low = mid + 1;
		else high = mid;
	}

	const previous = Math.max(0, low - 1);
	const nearest = Math.abs(view.x[previous] - x) <= Math.abs(view.x[low] - x) ? previous : low;
	return view.y[nearest];
}

function visibleIndexRange(
	x: Float64Array<ArrayBufferLike>,
	xMin: number,
	xMax: number
): { start: number; end: number } {
	if (x.length === 0 || !Number.isFinite(xMin) || !Number.isFinite(xMax)) {
		return { start: 0, end: x.length };
	}

	const min = Math.min(xMin, xMax);
	const max = Math.max(xMin, xMax);
	const start = lowerBound(x, min);
	const end = upperBound(x, max);

	return { start, end: Math.max(start, end) };
}

function lowerBound(values: Float64Array<ArrayBufferLike>, target: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (values[mid] < target) low = mid + 1;
		else high = mid;
	}
	return low;
}

function upperBound(values: Float64Array<ArrayBufferLike>, target: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (values[mid] <= target) low = mid + 1;
		else high = mid;
	}
	return low;
}

function formatDecodedValue(
	value: number | null,
	context: Pick<PlotSignal, 'unit' | 'factor' | 'offset' | 'valueDescriptions'>
): string {
	if (value === null || !Number.isFinite(value)) return '-';
	const formatted = Math.abs(value) >= 1000 ? value.toFixed(0) : value.toPrecision(4);
	const rawValue = physicalToRaw(value, context.factor, context.offset);
	const description =
		rawValue === null
			? undefined
			: context.valueDescriptions.find((item) => item.rawValue === rawValue)?.label;
	const withUnit = context.unit ? `${formatted} ${context.unit}` : formatted;
	return description ?? withUnit;
}

function physicalToRaw(value: number, factor: number, offset: number): number | null {
	if (!Number.isFinite(factor) || factor === 0 || !Number.isFinite(offset)) return null;
	const raw = (value - offset) / factor;
	const rounded = Math.round(raw);
	return Math.abs(raw - rounded) < 1e-6 ? rounded : null;
}
