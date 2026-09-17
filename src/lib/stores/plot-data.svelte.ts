import { createSignalColorAssigner } from '$lib/plot-colors.js';
import { orderPlotSignals } from '$lib/plot-signal-order.js';
import { plotAxes } from '$lib/stores/plot-axes.svelte.js';
import { dbcFiles, sourceLabel, type DbcSignalTarget } from '$lib/stores/dbc-files.svelte.js';
import { legendOrderMode } from '$lib/stores/preferences.svelte.js';
import { traceFile } from '$lib/stores/trace-file.svelte.js';
import {
	getMf4SignalValues,
	getSignalValues,
	type DecodedSignalSeries,
	type DbcValueType,
	type DbcValueDescription
} from '$lib/wasm.js';
import { SvelteMap } from 'svelte/reactivity';

type PlotSignalKey = string;
const NO_VALUE_DESCRIPTIONS: DbcValueDescription[] = [];

type SelectedSignalState = {
	isDecoding: boolean;
	series: DecodedSignalSeries | null;
	error: string | null;
};

export type PlotSignal = {
	key: PlotSignalKey;
	color: string;
	label: string;
	messageName: string;
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

export function isPlottableSignal(signal: PlotSignal): boolean {
	return Boolean(signal.series && signal.series.timesMs.length > 0);
}

class PlotDataStore {
	selectedSignals = new SvelteMap<PlotSignalKey, SelectedSignalState>();
	private signalColors = createSignalColorAssigner();

	signals = $derived.by<PlotSignal[]>(() => {
		const signals: PlotSignal[] = [];

		for (const [key, state] of this.selectedSignals) {
			const target = findSignalTarget(key);
			if (!target) continue;

			if (target.kind === 'dbc') {
				signals.push({
					key,
					color: this.signalColors.colorFor(key),
					label: `${target.value.message.name}.${target.value.signal.name}${sourceLabel(target.value.source)}`,
					messageName: target.value.message.name + sourceLabel(target.value.source),
					signalName: target.value.signal.name,
					unit: target.value.signal.unit,
					valueType: target.value.signal.valueType,
					factor: target.value.signal.factor,
					offset: target.value.signal.offset,
					minimum: target.value.signal.minimum,
					maximum: target.value.signal.maximum,
					valueDescriptions: target.value.signal.valueDescriptions,
					series: state.series
				});
			} else {
				signals.push({
					key,
					color: this.signalColors.colorFor(key),
					label: `${target.value.group.name}.${target.value.signal.name}`,
					messageName: target.value.group.name,
					signalName: target.value.signal.name,
					unit: target.value.signal.unit,
					valueType: 'float64',
					factor: 1,
					offset: 0,
					minimum: null,
					maximum: null,
					valueDescriptions: NO_VALUE_DESCRIPTIONS,
					series: state.series
				});
			}
		}

		return orderPlotSignals(signals, legendOrderMode.current);
	});

	hasPlottableSignals = $derived(this.signals.some(isPlottableSignal));

	isSignalSelected(key: PlotSignalKey): boolean {
		return this.selectedSignals.has(key);
	}

	signalDecodeStatus(key: PlotSignalKey) {
		const state = this.selectedSignals.get(key);
		return {
			isDecoding: state?.isDecoding ?? false,
			decodeError: state?.error ?? null
		};
	}

	async toggleSignal(key: PlotSignalKey): Promise<void> {
		if (this.isSignalSelected(key)) {
			this.selectedSignals.delete(key);
			this.signalColors.release(key);
			plotAxes.release(key);
			return;
		}

		this.signalColors.colorFor(key);
		this.selectedSignals.set(key, { isDecoding: false, series: null, error: null });
		await this.decodeSignal(key);
	}

	deselectDbcFile(dbcFileId: string): void {
		for (const [key, target] of Object.entries(dbcFiles.signalTargetByKey)) {
			if (target.file.id !== dbcFileId) continue;
			this.selectedSignals.delete(key);
			this.signalColors.release(key);
			plotAxes.release(key);
		}
	}

	clearSelectedSignals(): void {
		this.selectedSignals.clear();
		this.signalColors.clear();
		plotAxes.releaseAll();
	}

	private async decodeSignal(key: PlotSignalKey): Promise<void> {
		const trace = traceFile.entry;
		const target = findSignalTarget(key);
		if (!trace || !target) return;

		const decoding: SelectedSignalState = { isDecoding: true, series: null, error: null };
		this.selectedSignals.set(key, decoding);
		const isCurrent = () =>
			this.selectedSignals.get(key) === decoding &&
			traceFile.entry === trace &&
			findSignalTarget(key) !== null;

		try {
			const series =
				target.kind === 'mf4'
					? await getMf4SignalValues(trace.handle, target.value.signal.id)
					: await this.decodeDbcSignal(trace, target.value);

			if (!isCurrent()) {
				return;
			}

			this.selectedSignals.set(key, { isDecoding: false, series, error: null });
		} catch (error) {
			if (isCurrent()) {
				this.selectedSignals.set(key, {
					isDecoding: false,
					series: null,
					error: error instanceof Error ? error.message : 'Signal decode failed'
				});
			}
		} finally {
			if (this.selectedSignals.get(key) === decoding) {
				this.selectedSignals.set(key, { ...decoding, isDecoding: false });
			}
		}
	}

	private async decodeDbcSignal(
		trace: NonNullable<typeof traceFile.entry>,
		target: DbcSignalTarget
	) {
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
}

function findSignalTarget(key: PlotSignalKey) {
	const dbc = dbcFiles.signalTargetByKey[key];
	if (dbc) return { kind: 'dbc' as const, value: dbc };
	const mf4 = traceFile.mf4SignalTargetByKey.get(key);
	return mf4 ? { kind: 'mf4' as const, value: mf4 } : null;
}

export const plotData = new PlotDataStore();
