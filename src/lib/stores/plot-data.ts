import { createStore } from 'zustand/vanilla';
import { ownHmrSubscriptions } from './hmr-subscriptions.js';
import { createSignalColorAssigner } from '#lib/plot-colors.js';
import { orderPlotSignals } from '#lib/plot-signal-order.js';
import {
	getMf4SignalValues,
	getSignalValues,
	type DbcValueDescription,
	type DbcValueType,
	type DecodedSignalSeries
} from '#lib/wasm.js';
import { releaseAllAxes, releaseAxes } from './plot-axes.js';
import { dbcFiles, sourceLabel, type DbcSignalTarget } from './dbc-files.js';
import { preferences } from './preferences.js';
import { traceFile, type TraceFileEntry } from './trace-file.js';

export type SelectedSignalState = {
	status: 'idle' | 'decoding' | 'ready' | 'error';
	series: DecodedSignalSeries | null;
	error: string | null;
};

export type PlotSignal = {
	key: string;
	color: string;
	label: string;
	messageName: string;
	sourceBadges?: string[];
	signalName: string;
	valueType: DbcValueType;
	factor: number;
	offset: number;
	minimum: number | null;
	maximum: number | null;
	unit: string;
	valueDescriptions: DbcValueDescription[];
	series: DecodedSignalSeries | null;
};

export type PlotDataState = {
	selected: ReadonlyMap<string, SelectedSignalState>;
	/** Derived on every write from `selected`, the signal catalogues and the legend order. */
	signals: PlotSignal[];
	hasPlottableSignals: boolean;
};

const NO_VALUE_DESCRIPTIONS: DbcValueDescription[] = [];
const signalColors = createSignalColorAssigner();

export function isPlottableSignal(signal: PlotSignal): boolean {
	return Boolean(signal.series && signal.series.timesMs.length > 0);
}

let derivedFrom: unknown[] = [];

export const plotData = createStore<PlotDataState>()(() => signalsState(new Map()));

// Re-derive when a catalogue or the legend order changes; `signalsState` skips unchanged inputs.
const unsubscribes: (() => void)[] = [];
for (const store of [dbcFiles, traceFile, preferences] as const) {
	const unsubscribe = store.subscribe(() => {
		const next = signalsState(plotData.getState().selected);
		if (next.signals !== plotData.getState().signals) plotData.setState(next);
	});
	if (import.meta.hot) unsubscribes.push(unsubscribe);
}

if (import.meta.hot) ownHmrSubscriptions(import.meta.hot, unsubscribes);

export function isSignalSelected(key: string): boolean {
	return plotData.getState().selected.has(key);
}

export function signalDecodeStatus(
	key: string,
	selected: PlotDataState['selected'] = plotData.getState().selected
): { isDecoding: boolean; decodeError: string | null } {
	const state = selected.get(key);
	return { isDecoding: state?.status === 'decoding', decodeError: state?.error ?? null };
}

export async function toggleSignal(key: string): Promise<void> {
	if (isSignalSelected(key)) {
		const selected = new Map(plotData.getState().selected);
		selected.delete(key);
		signalColors.release(key);
		releaseAxes([key]);
		plotData.setState(signalsState(selected));
		return;
	}

	const target = findSignalTarget(key);
	if (!target || (target.kind === 'dbc' && target.value.unavailableReason)) return;

	signalColors.colorFor(key);
	setSignalState(key, { status: 'idle', series: null, error: null });
	await decodeSignal(key);
}

export function deselectDbcFile(dbcFileId: string): void {
	const selected = new Map(plotData.getState().selected);
	const released: string[] = [];
	for (const [key, target] of Object.entries(dbcFiles.getState().signalTargetByKey)) {
		if (target.file.id !== dbcFileId || !selected.delete(key)) continue;
		signalColors.release(key);
		released.push(key);
	}
	if (released.length === 0) return;
	releaseAxes(released);
	plotData.setState(signalsState(selected));
}

export function clearSelectedSignals(): void {
	signalColors.clear();
	releaseAllAxes();
	plotData.setState(signalsState(new Map()));
}

async function decodeSignal(key: string): Promise<void> {
	const trace = traceFile.getState().entry;
	const target = findSignalTarget(key);
	if (!trace || !target) return;

	const decoding: SelectedSignalState = { status: 'decoding', series: null, error: null };
	setSignalState(key, decoding);
	const isCurrent = () =>
		plotData.getState().selected.get(key) === decoding &&
		traceFile.getState().entry === trace &&
		findSignalTarget(key) !== null;

	try {
		const series =
			target.kind === 'mf4'
				? await getMf4SignalValues(trace.handle, target.value.signal.id)
				: await decodeDbcSignal(trace, target.value);

		if (isCurrent()) setSignalState(key, { status: 'ready', series, error: null });
	} catch (error) {
		if (isCurrent()) {
			setSignalState(key, {
				status: 'error',
				series: null,
				error: error instanceof Error ? error.message : 'Signal decode failed'
			});
		}
	} finally {
		if (plotData.getState().selected.get(key) === decoding) {
			setSignalState(key, { ...decoding, status: 'idle' });
		}
	}
}

function decodeDbcSignal(trace: TraceFileEntry, target: DbcSignalTarget) {
	if (!trace.hasRawFrames) {
		throw new Error('This trace has no raw CAN frames for DBC decoding.');
	}
	return getSignalValues(
		target.file.handle,
		trace.handle,
		{
			canId: target.message.canId,
			isExtended: target.message.isExtended,
			sizeBytes: target.message.sizeBytes
		},
		target.signal.name,
		target.source ? { ...target.source } : undefined
	);
}

function setSignalState(key: string, state: SelectedSignalState): void {
	plotData.setState(signalsState(new Map(plotData.getState().selected).set(key, state)));
}

function findSignalTarget(key: string) {
	const dbc = dbcFiles.getState().signalTargetByKey[key];
	if (dbc) return { kind: 'dbc' as const, value: dbc };
	const mf4 = traceFile.getState().mf4SignalTargetByKey.get(key);
	return mf4 ? { kind: 'mf4' as const, value: mf4 } : null;
}

function signalsState(selected: PlotDataState['selected']): PlotDataState {
	const dbcTargets = dbcFiles.getState().signalTargetByKey;
	const mf4Targets = traceFile.getState().mf4SignalTargetByKey;
	const order = preferences.getState().legendOrder;
	const inputs = [selected, dbcTargets, mf4Targets, order];
	if (inputs.every((input, index) => input === derivedFrom[index])) return plotData.getState();
	derivedFrom = inputs;

	const signals: PlotSignal[] = [];
	for (const [key, state] of selected) {
		const dbc = dbcTargets[key];
		if (dbc) {
			signals.push({
				key,
				color: signalColors.colorFor(key),
				label: `${dbc.message.name}.${dbc.signal.name}${sourceLabel(dbc.source)}`,
				messageName: dbc.message.name,
				sourceBadges: dbc.sourceBadges,
				signalName: dbc.signal.name,
				unit: dbc.signal.unit,
				valueType: dbc.signal.valueType,
				factor: dbc.signal.factor,
				offset: dbc.signal.offset,
				minimum: dbc.signal.minimum,
				maximum: dbc.signal.maximum,
				valueDescriptions: dbc.signal.valueDescriptions,
				series: state.series
			});
			continue;
		}

		const mf4 = mf4Targets.get(key);
		if (!mf4) continue;
		signals.push({
			key,
			color: signalColors.colorFor(key),
			label: `${mf4.group.name}.${mf4.signal.name}`,
			messageName: mf4.group.name,
			signalName: mf4.signal.name,
			unit: mf4.signal.unit,
			valueType: 'float64',
			factor: 1,
			offset: 0,
			minimum: null,
			maximum: null,
			valueDescriptions: NO_VALUE_DESCRIPTIONS,
			series: state.series
		});
	}

	const ordered = orderPlotSignals(signals, order);
	return { selected, signals: ordered, hasPlottableSignals: ordered.some(isPlottableSignal) };
}
