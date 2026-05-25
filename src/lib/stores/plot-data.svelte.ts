import { createSignalColorAssigner } from '$lib/plot-colors.js';
import { dbcFiles, displayDbcName, signalKey } from '$lib/stores/dbc-files.svelte.js';
import { traceFile } from '$lib/stores/trace-file.svelte.js';
import {
	getSignalValues,
	type DecodedSignalSeries,
	type DbcMessage,
	type DbcSignal,
	type DbcValueDescription
} from '$lib/wasm.js';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

export type PlotSignalKey = string;

export type PlotSignal = {
	key: PlotSignalKey;
	color: string;
	dbcFileId: string;
	dbcName: string;
	sourceFileName: string;
	messageName: string;
	signalName: string;
	label: string;
	canId: number;
	dbcId: number;
	isExtended: boolean;
	isFd: boolean;
	sizeBytes: number;
	transmitter: string;
	startBit: number;
	bitLength: number;
	endianness: string;
	signedness: string;
	factor: number;
	offset: number;
	minimum: number;
	maximum: number;
	unit: string;
	valueType: string;
	receivers: string[];
	valueDescriptions: DbcValueDescription[];
	series: DecodedSignalSeries | null;
	isDecoding: boolean;
	decodeError: string | null;
};

export function isPlottableSignal(signal: PlotSignal): boolean {
	return Boolean(signal.series && signal.series.timesMs.length >= 2);
}

class PlotDataStore {
	selectedSignalKeys = new SvelteSet<PlotSignalKey>();
	signalSeries = new SvelteMap<PlotSignalKey, DecodedSignalSeries>();
	decodingSignalKeys = new SvelteSet<PlotSignalKey>();
	decodeErrors = new SvelteMap<PlotSignalKey, string>();
	private signalColors = createSignalColorAssigner();

	signals = $derived.by<PlotSignal[]>(() => {
		const signals: PlotSignal[] = [];

		for (const key of this.selectedSignalKeys) {
			const target = findSignalTarget(key);
			if (!target) continue;

			signals.push(
				plotSignal(target.file.id, target.file.name, target.message, target.signal, {
					color: this.signalColors.colorFor(key),
					series: this.signalSeries.get(key),
					isDecoding: this.decodingSignalKeys.has(key),
					decodeError: this.decodeErrors.get(key)
				})
			);
		}

		return signals;
	});

	hasPlottableSignals = $derived(this.signals.some(isPlottableSignal));

	selectedSignalsByKey = $derived.by(
		() => new Map(this.signals.map((signal) => [signal.key, signal]))
	);

	isSignalSelected(key: PlotSignalKey): boolean {
		return this.selectedSignalKeys.has(key);
	}

	signalDecodeStatus(key: PlotSignalKey): { isDecoding: boolean; decodeError: string | null } {
		const signal = this.selectedSignalsByKey.get(key);
		if (!signal) {
			return { isDecoding: false, decodeError: null };
		}

		return { isDecoding: signal.isDecoding, decodeError: signal.decodeError };
	}

	async toggleSignal(key: PlotSignalKey): Promise<void> {
		if (this.isSignalSelected(key)) {
			this.selectedSignalKeys.delete(key);
			this.setSignalSeries(key, null);
			this.setDecodeError(key, null);
			this.decodingSignalKeys.delete(key);
			this.signalColors.release(key);
			return;
		}

		this.signalColors.colorFor(key);
		this.selectedSignalKeys.add(key);
		await this.decodeSignal(key);
	}

	deselectDbcFile(dbcFileId: string): void {
		const dbcSignalKeys = new Set(
			dbcFiles.sidebarFiles
				.find((file) => file.id === dbcFileId)
				?.signals.map((signal) => signal.key) ?? []
		);

		for (const key of dbcSignalKeys) {
			this.selectedSignalKeys.delete(key);
			this.decodingSignalKeys.delete(key);
			this.signalSeries.delete(key);
			this.decodeErrors.delete(key);
		}
		for (const key of dbcSignalKeys) {
			this.signalColors.release(key);
		}
	}

	clearSelectedSignals(): void {
		this.selectedSignalKeys.clear();
		this.signalSeries.clear();
		this.decodingSignalKeys.clear();
		this.decodeErrors.clear();
		this.signalColors.clear();
	}

	setSignalSeries(key: PlotSignalKey, series: DecodedSignalSeries | null): void {
		if (series) {
			this.signalSeries.set(key, series);
		} else {
			this.signalSeries.delete(key);
		}
	}

	private async decodeSignal(key: PlotSignalKey): Promise<void> {
		const trace = traceFile.entry;
		const target = findSignalTarget(key);
		if (!trace || !target) return;

		this.setDecodeError(key, null);
		this.decodingSignalKeys.add(key);

		try {
			const series = await getSignalValues(
				target.file.handle,
				trace,
				target.message.name,
				target.signal.name
			);

			if (!this.isSignalSelected(key) || traceFile.entry !== trace || !findSignalTarget(key)) {
				return;
			}

			this.setSignalSeries(key, series);
		} catch (error) {
			if (this.isSignalSelected(key) && traceFile.entry === trace && findSignalTarget(key)) {
				this.setDecodeError(key, error instanceof Error ? error.message : 'Signal decode failed');
			}
		} finally {
			this.decodingSignalKeys.delete(key);
		}
	}

	private setDecodeError(key: PlotSignalKey, error: string | null): void {
		if (error) {
			this.decodeErrors.set(key, error);
		} else {
			this.decodeErrors.delete(key);
		}
	}
}

type PlotSignalData = {
	color: string;
	series: DecodedSignalSeries | undefined;
	isDecoding: boolean;
	decodeError: string | undefined;
};

function plotSignal(
	dbcFileId: string,
	sourceFileName: string,
	message: DbcMessage,
	signal: DbcSignal,
	data: PlotSignalData
): PlotSignal {
	return {
		key: signalKey(dbcFileId, message.name, signal.name),
		color: data.color,
		dbcFileId,
		dbcName: displayDbcName(sourceFileName),
		sourceFileName,
		messageName: message.name,
		signalName: signal.name,
		label: `${message.name}.${signal.name}`,
		canId: message.canId,
		dbcId: message.dbcId,
		isExtended: message.isExtended,
		isFd: message.isFd,
		sizeBytes: message.sizeBytes,
		transmitter: message.transmitter,
		startBit: signal.startBit,
		bitLength: signal.bitLength,
		endianness: signal.endianness,
		signedness: signal.signedness,
		factor: signal.factor,
		offset: signal.offset,
		minimum: signal.minimum,
		maximum: signal.maximum,
		unit: signal.unit,
		valueType: signal.valueType,
		receivers: signal.receivers,
		valueDescriptions: signal.valueDescriptions,
		series: data.series ?? null,
		isDecoding: data.isDecoding,
		decodeError: data.decodeError ?? null
	};
}

function findSignalTarget(key: PlotSignalKey) {
	return dbcFiles.signalTargetByKey.get(key) ?? null;
}

export const plotData = new PlotDataStore();
