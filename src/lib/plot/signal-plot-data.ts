import {
	paddedXRange,
	paddedYRange,
	type PlotAxisRange,
	type PlotViewport
} from '@/lib/plot/plot-viewport';
import type { PlotSignal } from '@/stores/derive';
import type { TimestampMode } from '@/stores/store';

type DecodedValueFormatContext = Pick<
	PlotSignal,
	'unit' | 'valueType' | 'factor' | 'offset' | 'minimum' | 'maximum' | 'valueDescriptions'
>;

export type SignalView = Omit<PlotSignal, 'series'> & { x: Float64Array; y: Float64Array };

export type LegendSignalValue = {
	text: string;
	outOfRange: boolean;
};

type SignalSample = {
	timeMs: number;
	value: number;
};

export type WindowedSignalView = SignalView & { sampled: boolean };

const LEGEND_MAX_SIGNIFICANT_DIGITS = 7;

export function isOutsideDbcRange(
	value: number,
	minimum: number | null,
	maximum: number | null
): boolean {
	if (minimum === 0 && maximum === 0) return false;
	return (minimum !== null && value < minimum) || (maximum !== null && value > maximum);
}

function decimalPlaces(value: number): number {
	if (!Number.isFinite(value) || value === 0) return 0;
	const [mantissa, exponent] = Math.abs(value).toExponential().split('e');
	const dotIndex = mantissa.indexOf('.');
	const mantissaDecimals = dotIndex === -1 ? 0 : mantissa.length - dotIndex - 1;
	return Math.max(0, mantissaDecimals - Number(exponent));
}

function roundToResolution(value: number, factor: number, offset: number): number {
	const decimals = Math.max(decimalPlaces(factor), decimalPlaces(offset));
	if (decimals > 100) return value;
	return Number(value.toFixed(decimals));
}

export function formatLegendNumericValue(value: number, factor: number | null, offset = 0): string {
	if (!Number.isFinite(value)) return '-';
	if (value === 0) return '0';

	const magnitude = Math.abs(value);
	if (magnitude >= 1_000_000 || magnitude < 1e-6) {
		return value.toExponential(LEGEND_MAX_SIGNIFICANT_DIGITS - 1);
	}

	if (factor === null) return roundToLegendPrecision(value).toString();

	const resolutionDecimals = Math.max(decimalPlaces(factor), decimalPlaces(offset));
	const integerDigits = magnitude >= 1 ? Math.floor(Math.log10(magnitude)) + 1 : 1;
	const fractionDigits = Math.min(
		resolutionDecimals,
		Math.max(0, LEGEND_MAX_SIGNIFICANT_DIGITS - integerDigits)
	);
	return value.toFixed(fractionDigits);
}

function roundToLegendPrecision(value: number): number {
	return Number(value.toPrecision(LEGEND_MAX_SIGNIFICANT_DIGITS));
}

export function formatDecodedValue(value: number | null, context: DecodedValueFormatContext) {
	if (value === null || !Number.isFinite(value)) {
		return { text: '-', outOfRange: false };
	}

	const floating = context.valueType !== 'integer';
	const outOfRange = isOutsideDbcRange(
		floating
			? roundToLegendPrecision(value)
			: roundToResolution(value, context.factor, context.offset),
		floating && context.minimum !== null
			? roundToLegendPrecision(context.minimum)
			: context.minimum,
		floating && context.maximum !== null ? roundToLegendPrecision(context.maximum) : context.maximum
	);
	const formatted = formatLegendNumericValue(
		value,
		context.valueType === 'integer' ? context.factor : null,
		context.offset
	);
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

const EMPTY_SERIES = new Float64Array(0);

function signalView({ series, ...signal }: PlotSignal): SignalView {
	return { ...signal, x: series?.timesMs ?? EMPTY_SERIES, y: series?.values ?? EMPTY_SERIES };
}

/** Views for `signals`, reusing each of `previous` that still matches so its identity holds. */
export function signalViews(signals: PlotSignal[], previous: readonly SignalView[]): SignalView[] {
	const previousByKey = new Map(previous.map((view) => [view.key, view]));
	return signals.map((signal) => {
		const view = previousByKey.get(signal.key);
		return view !== undefined && viewMatchesSignal(view, signal) ? view : signalView(signal);
	});
}

function viewMatchesSignal(view: SignalView, signal: PlotSignal): boolean {
	return (
		view.x === (signal.series?.timesMs ?? EMPTY_SERIES) &&
		view.y === (signal.series?.values ?? EMPTY_SERIES) &&
		view.color === signal.color &&
		view.label === signal.label &&
		view.sourceBadges === signal.sourceBadges &&
		view.unit === signal.unit &&
		view.valueType === signal.valueType &&
		view.factor === signal.factor &&
		view.offset === signal.offset &&
		view.minimum === signal.minimum &&
		view.maximum === signal.maximum &&
		view.valueDescriptions === signal.valueDescriptions
	);
}

export function crosshairValue(view: SignalView, x: number): LegendSignalValue {
	return formatDecodedValue(nearestSignalSample(view.x, view.y, x)?.value ?? null, view);
}

export function crosshairDeltaValue(
	view: SignalView,
	fromX: number,
	toX: number
): LegendSignalValue {
	if (view.valueDescriptions.length > 0) {
		return { text: 'N/A', outOfRange: false };
	}

	const from = nearestSignalSample(view.x, view.y, fromX)?.value ?? null;
	const to = nearestSignalSample(view.x, view.y, toX)?.value ?? null;
	if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) {
		return { text: '-', outOfRange: false };
	}

	const formatted = formatLegendNumericValue(
		to - from,
		view.valueType === 'integer' ? view.factor : null
	);
	return {
		text: view.unit ? `${formatted} ${view.unit}` : formatted,
		outOfRange: false
	};
}

function combinedDomain(views: SignalView[]): ViewDomain | null {
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

	return Number.isFinite(xMin) && Number.isFinite(yMin) ? { xMin, xMax, yMin, yMax } : null;
}

export function signalXRange(views: SignalView[]): PlotAxisRange | null {
	const domain = combinedDomain(views);
	return domain === null ? null : paddedXRange(domain.xMin, domain.xMax);
}

export function signalYRange(views: SignalView[]): PlotAxisRange | null {
	const domain = combinedDomain(views);
	return domain === null ? null : paddedYRange(domain.yMin, domain.yMax);
}

export function axisSplitDomain(
	allViews: SignalView[],
	primaryViews: SignalView[]
): PlotViewport | null {
	const x = signalXRange(allViews);
	if (x === null) return null;
	const y = signalYRange(primaryViews) ?? EMPTY_AXIS_RANGE;

	return { xMin: x.min, xMax: x.max, yMin: y.min, yMax: y.max };
}

export const EMPTY_AXIS_RANGE: PlotAxisRange = { min: 0, max: 1 };

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

	return secondsText(value / 1000);
}

export function formatTimeDelta(valueMs: number): string {
	if (!Number.isFinite(valueMs)) return '';
	return `${valueMs < 0 ? '-' : ''}${secondsText(Math.abs(valueMs) / 1000)}`;
}

function secondsText(seconds: number): string {
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

const viewDomainCache = new WeakMap<SignalView, ViewDomain | null>();

function viewDomain(view: SignalView): ViewDomain | null {
	const cached = viewDomainCache.get(view);
	if (cached !== undefined) return cached;

	const { x, y } = view;
	let xMin = Number.POSITIVE_INFINITY;
	let xMax = Number.NEGATIVE_INFINITY;
	let yMin = Number.POSITIVE_INFINITY;
	let yMax = Number.NEGATIVE_INFINITY;

	for (let index = 0; index < x.length; index += 1) {
		const xValue = x[index];
		const yValue = y[index];
		if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue;
		if (xValue < xMin) xMin = xValue;
		if (xValue > xMax) xMax = xValue;
		if (yValue < yMin) yMin = yValue;
		if (yValue > yMax) yMax = yValue;
	}

	const domain = xMin === Number.POSITIVE_INFINITY ? null : { xMin, xMax, yMin, yMax };
	viewDomainCache.set(view, domain);
	return domain;
}

export function nearestSignalSample(
	timesMs: Float64Array,
	values: Float64Array,
	timeMs: number
): SignalSample | null {
	const points = Math.min(timesMs.length, values.length);
	if (points === 0 || !Number.isFinite(timeMs)) return null;
	const low = Math.min(bisect(timesMs, timeMs, false), points - 1);
	const previous = Math.max(0, low - 1);
	const nearest =
		Math.abs(timesMs[previous] - timeMs) <= Math.abs(timesMs[low] - timeMs) ? previous : low;
	return { timeMs: timesMs[nearest], value: values[nearest] };
}

function visibleIndexRange(x: Float64Array, xMin: number, xMax: number) {
	if (x.length === 0 || !Number.isFinite(xMin) || !Number.isFinite(xMax)) {
		return { start: 0, end: x.length };
	}

	const min = Math.min(xMin, xMax);
	const max = Math.max(xMin, xMax);
	const start = bisect(x, min, false);
	const end = bisect(x, max, true);

	return { start, end: Math.max(start, end) };
}

export function renderIndexRange(x: Float64Array, xMin: number, xMax: number) {
	const { start, end } = visibleIndexRange(x, xMin, xMax);
	if (start < end) {
		return {
			start: Math.max(0, start - 1),
			end: Math.min(x.length, end + 1)
		};
	}

	if (start > 0 && start < x.length) {
		return { start: start - 1, end: start + 1 };
	}

	return { start, end };
}

/** The first index holding a value at or above `target`, or above it when `inclusive`. */
function bisect(values: Float64Array, target: number, inclusive: boolean): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (inclusive ? values[mid] <= target : values[mid] < target) low = mid + 1;
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
