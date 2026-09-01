import { SIGNAL_COLORS } from '$lib/plot-colors.js';
import { PRIMARY_Y_AXIS_ID, type YAxisId } from '$lib/plot-axes.js';
import type { PlotAxisRange } from '$lib/plot-viewport.js';

/** Shared point budget from `PlotWindow`, frozen for this spike. */
export const SPIKE_TOTAL_POINTS = 50_000;
export const SPIKE_SERIES_COUNT = 4;
export const SPIKE_POINTS_PER_SERIES = SPIKE_TOTAL_POINTS / SPIKE_SERIES_COUNT;
export const SPIKE_X_MAX_MS = 60_000;
export const SPIKE_DOMAIN_UPDATES = 60;
export const SPIKE_RESIZE_STEPS = 10;
export const SPIKE_WARMUP = 5;
export const SPIKE_PLOT_WIDTH = 960;
export const SPIKE_PLOT_HEIGHT = 480;
export const SPIKE_SECONDARY_AXIS_ID: YAxisId = 'y2';

export type SpikeSeries = {
	key: string;
	label: string;
	yAxis: YAxisId;
	color: string;
	x: Float64Array;
	y: Float64Array;
	points: number;
};

export type SpikeViewport = {
	xMin: number;
	xMax: number;
	primary: PlotAxisRange;
	secondary: PlotAxisRange;
};

export type SpikeWorkload = {
	indexes: readonly number[];
	series: readonly SpikeSeries[];
	xMin: number;
	xMax: number;
	primary: PlotAxisRange;
	secondary: PlotAxisRange;
	fit: SpikeViewport;
};

let cached: SpikeWorkload | null = null;

/** Deterministic 50k-point CAN-like traces. Arrays are created once and reused. */
export function spikeWorkload(): SpikeWorkload {
	cached ??= buildSpikeWorkload();
	return cached;
}

export function buildSpikeWorkload(seed = 148): SpikeWorkload {
	const random = mulberry32(seed);
	const points = SPIKE_POINTS_PER_SERIES;
	const indexes = Object.freeze(Array.from({ length: points }, (_, index) => index));
	const x = new Float64Array(points);
	const step = SPIKE_X_MAX_MS / (points - 1);
	for (let index = 0; index < points; index += 1) x[index] = index * step;

	const series: SpikeSeries[] = [
		buildSeries(
			'eng_rpm',
			'EngineSpeed',
			PRIMARY_Y_AXIS_ID,
			SIGNAL_COLORS[0],
			x,
			800,
			2_200,
			0.35,
			random
		),
		buildSeries(
			'veh_speed',
			'VehicleSpeed',
			PRIMARY_Y_AXIS_ID,
			SIGNAL_COLORS[1],
			x,
			0,
			38,
			0.11,
			random
		),
		buildSeries(
			'batt_v',
			'BatteryVoltage',
			SPIKE_SECONDARY_AXIS_ID,
			SIGNAL_COLORS[2],
			x,
			11.8,
			14.6,
			1.7,
			random
		),
		buildSeries(
			'coolant',
			'CoolantTemp',
			SPIKE_SECONDARY_AXIS_ID,
			SIGNAL_COLORS[3],
			x,
			70,
			98,
			0.07,
			random
		)
	];

	const primary = yRange(series.filter((item) => item.yAxis === PRIMARY_Y_AXIS_ID));
	const secondary = yRange(series.filter((item) => item.yAxis === SPIKE_SECONDARY_AXIS_ID));
	const fit: SpikeViewport = {
		xMin: 0,
		xMax: SPIKE_X_MAX_MS,
		primary,
		secondary
	};

	return {
		indexes,
		series,
		xMin: 0,
		xMax: SPIKE_X_MAX_MS,
		primary,
		secondary,
		fit
	};
}

export function domainUpdateViewports(
	workload: SpikeWorkload,
	count = SPIKE_DOMAIN_UPDATES
): SpikeViewport[] {
	const window = workload.xMax * 0.25;
	const maxStart = Math.max(0, workload.xMax - window);
	return Array.from({ length: count }, (_, index) => {
		const start = count === 1 ? 0 : (index / (count - 1)) * maxStart;
		return {
			xMin: start,
			xMax: start + window,
			primary: workload.primary,
			secondary: workload.secondary
		};
	});
}

export function resizeSteps(count = SPIKE_RESIZE_STEPS): { width: number; height: number }[] {
	return Array.from({ length: count }, (_, index) => {
		const t = count === 1 ? 0 : index / (count - 1);
		return {
			width: Math.round(640 + t * 640),
			height: Math.round(400 + t * 160)
		};
	});
}

function buildSeries(
	key: string,
	label: string,
	yAxis: YAxisId,
	color: string,
	x: Float64Array,
	min: number,
	max: number,
	cycles: number,
	random: () => number
): SpikeSeries {
	const y = new Float64Array(x.length);
	const mid = (min + max) / 2;
	const amp = (max - min) / 2;
	for (let index = 0; index < x.length; index += 1) {
		const phase = (index / (x.length - 1)) * Math.PI * 2 * cycles;
		y[index] =
			mid +
			amp * Math.sin(phase) +
			amp * 0.08 * Math.sin(phase * 7) +
			amp * 0.04 * (random() * 2 - 1);
	}
	return { key, label, yAxis, color, x, y, points: x.length };
}

function yRange(series: readonly SpikeSeries[]): PlotAxisRange {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const item of series) {
		for (const value of item.y) {
			if (value < min) min = value;
			if (value > max) max = value;
		}
	}
	const padding = (max - min) * 0.05;
	return { min: min - padding, max: max + padding };
}

function mulberry32(seed: number): () => number {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let next = Math.imul(state ^ (state >>> 15), 1 | state);
		next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
		return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
	};
}
