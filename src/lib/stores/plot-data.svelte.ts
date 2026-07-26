import { createSignalColorAssigner } from '$lib/plot-colors.js';
import { orderPlotSignals } from '$lib/plot-signal-order.js';
import { plotAxes } from '$lib/stores/plot-axes.svelte.js';
import { dbcFiles, signalIdentityKey, type DbcSignalTarget } from '$lib/stores/dbc-files.svelte.js';
import { legendOrderMode } from '$lib/stores/preferences.svelte.js';
import { traceFile } from '$lib/stores/trace-file.svelte.js';
import {
	getMf4SignalValues,
	getSignalValues,
	type DecodedSignalSeries,
	type DbcValueDescription
} from '$lib/wasm.js';
import type { Mf4SignalTarget } from '$lib/mf4-signals.js';
import { SvelteMap } from 'svelte/reactivity';

type PlotSignalKey = string;

type SelectedSignalState = {
	status: 'idle' | 'decoding' | 'ready' | 'error';
	series: DecodedSignalSeries | null;
	error: string | null;
};

export type PlotSignal = {
	key: PlotSignalKey;
	color: string;
	label: string;
	messageName: string;
	signalName: string;
	factor: number;
	offset: number;
	minimum: number;
	maximum: number;
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
					label: `${target.value.message.name}.${target.value.signal.name}`,
					messageName: target.value.message.name,
					signalName: target.value.signal.name,
					unit: target.value.signal.unit,
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
					factor: 1,
					offset: 0,
					minimum: Number.NaN,
					maximum: Number.NaN,
					valueDescriptions: [],
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

	signalDecodeStatus(key: PlotSignalKey): { isDecoding: boolean; decodeError: string | null } {
		const state = this.selectedSignals.get(key);
		if (!state) {
			return { isDecoding: false, decodeError: null };
		}

		return {
			isDecoding: state.status === 'decoding',
			decodeError: state.error
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
		this.setSignalState(key, { status: 'idle', series: null, error: null });
		await this.decodeSignal(key);
	}

	deselectDbcFile(dbcFileId: string): void {
		const entry = dbcFiles.files.find((file) => file.id === dbcFileId);
		const dbcSignalKeys = new Set(
			entry?.catalog.messages.flatMap((message) =>
				message.signals.map((signal) => signalIdentityKey(dbcFileId, message, signal.name))
			) ?? []
		);

		for (const key of dbcSignalKeys) {
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

		this.setSignalState(key, { status: 'decoding', series: null, error: null });

		try {
			const series =
				target.kind === 'mf4'
					? await getMf4SignalValues(trace.handle, target.value.signal.id)
					: await this.decodeDbcSignal(trace, target.value);

			if (!this.isSignalSelected(key) || traceFile.entry !== trace || !findSignalTarget(key)) {
				return;
			}

			this.setSignalState(key, { status: 'ready', series, error: null });
		} catch (error) {
			if (this.isSignalSelected(key) && traceFile.entry === trace && findSignalTarget(key)) {
				this.setSignalState(key, {
					status: 'error',
					series: null,
					error: error instanceof Error ? error.message : 'Signal decode failed'
				});
			}
		} finally {
			const state = this.selectedSignals.get(key);
			if (state?.status === 'decoding') {
				this.setSignalState(key, { ...state, status: 'idle' });
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
			target.signal.name
		);
	}

	private setSignalState(key: PlotSignalKey, state: SelectedSignalState): void {
		this.selectedSignals.set(key, state);
	}
}

function findSignalTarget(key: PlotSignalKey) {
	const dbc = dbcFiles.signalTargetByKey[key];
	if (dbc) return { kind: 'dbc' as const, value: dbc };
	const mf4 = traceFile.mf4SignalTargetByKey[key] as Mf4SignalTarget | undefined;
	return mf4 ? { kind: 'mf4' as const, value: mf4 } : null;
}

export const plotData = new PlotDataStore();
