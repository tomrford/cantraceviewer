import type { SeriesConfig } from 'chartgpu';
import { paddedViewport, type PlotViewport } from './plot-viewport';
import type { PlotSignal } from './stores/plot-data.svelte.js';
import type { TimestampMode } from './stores/preferences.svelte.js';

export type DecodedValueFormatContext = Pick<
	PlotSignal,
	'unit' | 'factor' | 'offset' | 'minimum' | 'maximum' | 'valueDescriptions'
>;

export type SignalView = {
	key: string;
	label: string;
	messageName: string;
	signalName: string;
	unit: string;
	color: string;
	x: Float64Array;
	y: Float64Array;
	points: number;
	latestText: string;
	factor: number;
	offset: number;
	minimum: number;
	maximum: number;
	valueDescriptions: PlotSignal['valueDescriptions'];
};

export type LegendMarkerValue = {
	key: string;
	text: string;
	outOfRange: boolean;
};

export type VisibleSignalView = SignalView & {
	x: Float64Array<ArrayBufferLike>;
	y: Float64Array<ArrayBufferLike>;
};

const DEFAULT_TOTAL_SAMPLING_THRESHOLD = 25_000;
const LEGEND_MAX_SIGNIFICANT_DIGITS = 7;

export function isOutsideDbcRange(value: number, minimum: number, maximum: number): boolean {
	// DBC `[0|0]` is the conventional placeholder for unspecified limits.
	if (minimum === 0 && maximum === 0) return false;
	return value < minimum || value > maximum;
}

/** Decimal places of a finite number, e.g. 0.01 → 2, 0.5 → 1, 1e-13 → 13. */
function decimalPlaces(value: number): number {
	if (!Number.isFinite(value) || value === 0) return 0;
	const [mantissa, exponent] = Math.abs(value).toExponential().split('e');
	const dotIndex = mantissa.indexOf('.');
	const mantissaDecimals = dotIndex === -1 ? 0 : mantissa.length - dotIndex - 1;
	return Math.max(0, mantissaDecimals - Number(exponent));
}

/**
 * Snap a decoded value to the signal resolution so float noise from
 * `raw * factor + offset` cannot push boundary samples across DBC limits.
 */
function roundToResolution(value: number, factor: number, offset: number): number {
	const decimals = Math.max(decimalPlaces(factor), decimalPlaces(offset));
	if (decimals > 100) return value;
	return Number(value.toFixed(decimals));
}

/**
 * Legend precision policy: decimal places follow the signal resolution
 * (factor/offset), padded so a signal's values keep a stable width, capped to a
 * seven-significant-digit budget. Extreme magnitudes fall back to scientific
 * notation like the axis labels.
 */
export function formatLegendNumericValue(value: number, factor: number, offset = 0): string {
	if (!Number.isFinite(value)) return '-';
	if (value === 0) return '0';

	const magnitude = Math.abs(value);
	if (magnitude >= 1_000_000 || magnitude < 1e-6) {
		return value.toExponential(LEGEND_MAX_SIGNIFICANT_DIGITS - 1);
	}

	const resolutionDecimals = Math.max(decimalPlaces(factor), decimalPlaces(offset));
	const integerDigits = magnitude >= 1 ? Math.floor(Math.log10(magnitude)) + 1 : 1;
	const fractionDigits = Math.min(
		resolutionDecimals,
		Math.max(0, LEGEND_MAX_SIGNIFICANT_DIGITS - integerDigits)
	);
	return value.toFixed(fractionDigits);
}

export function formatDecodedValue(
	value: number | null,
	context: DecodedValueFormatContext
): { text: string; outOfRange: boolean } {
	if (value === null || !Number.isFinite(value)) {
		return { text: '-', outOfRange: false };
	}

	// Range-check the resolution-rounded value so the warning agrees with the
	// displayed text instead of raw float noise.
	const outOfRange = isOutsideDbcRange(
		roundToResolution(value, context.factor, context.offset),
		context.minimum,
		context.maximum
	);
	const formatted = formatLegendNumericValue(value, context.factor, context.offset);
	const rawValue = physicalToRaw(value, context.factor, context.offset);
	const description =
		rawValue === null
			? undefined
			: context.valueDescriptions.find((item) => item.rawValue === rawValue)?.label;
	const withUnit = context.unit ? `${formatted} ${context.unit}` : formatted;

	return {
		text: description ?? withUnit,
		outOfRange
	};
}

export function signalView(signal: PlotSignal): SignalView {
	const series = signal.series;
	const sourceTimes = series?.timesMs ?? new Float64Array(0);
	const sourceValues = series?.values ?? new Float64Array(0);
	const latest = formatDecodedValue(sourceValues.at(-1) ?? null, signal);

	return {
		key: signal.key,
		label: signal.label,
		messageName: signal.messageName,
		signalName: signal.signalName,
		unit: signal.unit,
		color: signal.color,
		x: sourceTimes,
		y: sourceValues,
		points: sourceTimes.length,
		latestText: latest.text,
		factor: signal.factor,
		offset: signal.offset,
		minimum: signal.minimum,
		maximum: signal.maximum,
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
		lineStyle: { color: view.color, width: 2.5, opacity: 0.95 },
		sampling: 'lttb',
		samplingThreshold
	};
}

export function lineSeriesForViews(views: SignalView[]): SeriesConfig[] {
	const plottedViews = views.filter((view) => view.points > 0);
	return plottedViews.map((view) => lineSeries(view, plottedViews.length));
}

export function markerValue(view: SignalView, x: number): LegendMarkerValue {
	const formatted = formatDecodedValue(nearestValue(view, x), view);
	return {
		key: view.key,
		text: formatted.text,
		outOfRange: formatted.outOfRange
	};
}

export function signalDomain(views: SignalView[]): PlotViewport | null {
	let xMin = Number.POSITIVE_INFINITY;
	let xMax = Number.NEGATIVE_INFINITY;
	let yMin = Number.POSITIVE_INFINITY;
	let yMax = Number.NEGATIVE_INFINITY;

	for (const view of views) {
		const domain = viewDomain(view);
		if (domain === null) continue;
		xMin = Math.min(xMin, domain.xMin);
		xMax = Math.max(xMax, domain.xMax);
		yMin = Math.min(yMin, domain.yMin);
		yMax = Math.max(yMax, domain.yMax);
	}

	return paddedViewport(xMin, xMax, yMin, yMax);
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

export function formatAxisValue(value: number): string | null {
	if (!Number.isFinite(value)) return null;
	if (Object.is(value, -0) || Math.abs(value) < 1e-12) return '0';

	const magnitude = Math.abs(value);
	if (magnitude >= 1_000_000 || magnitude < 0.001) {
		return value.toExponential(2);
	}

	const maximumFractionDigits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 3;
	return new Intl.NumberFormat('en-US', {
		maximumFractionDigits,
		useGrouping: false
	}).format(value);
}

type ViewDomain = { xMin: number; xMax: number; yMin: number; yMax: number };

// Keyed on the underlying immutable series arrays so the per-view scan survives
// view objects being rebuilt on every derived tick.
const viewDomainCache = new WeakMap<
	Float64Array<ArrayBufferLike>,
	{ y: Float64Array<ArrayBufferLike>; domain: ViewDomain | null }
>();

function viewDomain(view: SignalView): ViewDomain | null {
	const cached = viewDomainCache.get(view.x);
	if (cached !== undefined && cached.y === view.y) return cached.domain;

	const domain = scanViewDomain(view.x, view.y, view.points);
	viewDomainCache.set(view.x, { y: view.y, domain });
	return domain;
}

function scanViewDomain(
	x: Float64Array<ArrayBufferLike>,
	y: Float64Array<ArrayBufferLike>,
	points: number
): ViewDomain | null {
	let xMin = Number.POSITIVE_INFINITY;
	let xMax = Number.NEGATIVE_INFINITY;
	let yMin = Number.POSITIVE_INFINITY;
	let yMax = Number.NEGATIVE_INFINITY;

	for (let index = 0; index < points; index += 1) {
		const xValue = x[index];
		const yValue = y[index];
		if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue;
		if (xValue < xMin) xMin = xValue;
		if (xValue > xMax) xMax = xValue;
		if (yValue < yMin) yMin = yValue;
		if (yValue > yMax) yMax = yValue;
	}

	if (
		!Number.isFinite(xMin) ||
		!Number.isFinite(xMax) ||
		!Number.isFinite(yMin) ||
		!Number.isFinite(yMax)
	) {
		return null;
	}
	return { xMin, xMax, yMin, yMax };
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

function physicalToRaw(value: number, factor: number, offset: number): number | null {
	if (!Number.isFinite(factor) || factor === 0 || !Number.isFinite(offset)) return null;
	const raw = (value - offset) / factor;
	const rounded = Math.round(raw);
	return Math.abs(raw - rounded) < 1e-6 ? rounded : null;
}
