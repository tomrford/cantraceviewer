import { dbcFiles, signalKey, type DbcFileEntry } from '$lib/stores/dbc-files.svelte.js';
import { traceFile } from '$lib/stores/trace-file.svelte.js';
import {
	getSignalValues,
	type DbcMessage,
	type DbcSignal,
	type DbcValueDescription,
	type SignalSample
} from '$lib/wasm.js';

export type PlotSignalKey = string;

export type PlotSignal = {
	key: PlotSignalKey;
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
	samples: SignalSample[] | null;
	isDecoding: boolean;
	decodeError: string | null;
};

class PlotDataStore {
	selectedSignalKeys = $state<PlotSignalKey[]>([]);
	signalSamples = $state<Record<PlotSignalKey, SignalSample[]>>({});
	decodingSignalKeys = $state<PlotSignalKey[]>([]);
	decodeErrors = $state<Record<PlotSignalKey, string>>({});

	signals = $derived.by<PlotSignal[]>(() => {
		const selected = new Set(this.selectedSignalKeys);
		const signals: PlotSignal[] = [];

		for (const file of dbcFiles.files) {
			for (const message of file.catalog.messages) {
				for (const signal of message.signals) {
					const key = signalKey(file.id, message.name, signal.name);
					if (!selected.has(key)) continue;

					signals.push(
						plotSignal(file.id, file.file.name, message, signal, {
							samples: this.signalSamples[key],
							isDecoding: this.decodingSignalKeys.includes(key),
							decodeError: this.decodeErrors[key]
						})
					);
				}
			}
		}

		return signals;
	});

	isSignalSelected(key: PlotSignalKey): boolean {
		return this.selectedSignalKeys.includes(key);
	}

	async toggleSignal(key: PlotSignalKey): Promise<void> {
		if (this.isSignalSelected(key)) {
			this.selectedSignalKeys = arrayWith(this.selectedSignalKeys, key, false);
			this.setSignalSamples(key, null);
			this.setDecodeError(key, null);
			this.decodingSignalKeys = arrayWith(this.decodingSignalKeys, key, false);
			return;
		}

		this.selectedSignalKeys = arrayWith(this.selectedSignalKeys, key, true);
		await this.decodeSignal(key);
	}

	deselectDbcFile(dbcFileId: string): void {
		const liveKeys = new Set(
			dbcFiles.sidebarFiles
				.find((file) => file.id === dbcFileId)
				?.signals.map((signal) => signal.key) ?? []
		);

		this.selectedSignalKeys = this.selectedSignalKeys.filter((key) => !liveKeys.has(key));
		this.signalSamples = Object.fromEntries(
			Object.entries(this.signalSamples).filter(([key]) => !liveKeys.has(key))
		);
		this.decodeErrors = Object.fromEntries(
			Object.entries(this.decodeErrors).filter(([key]) => !liveKeys.has(key))
		);
		this.decodingSignalKeys = this.decodingSignalKeys.filter((key) => !liveKeys.has(key));
	}

	clearSelectedSignals(): void {
		this.selectedSignalKeys = [];
		this.signalSamples = {};
		this.decodingSignalKeys = [];
		this.decodeErrors = {};
	}

	setSignalSamples(key: PlotSignalKey, samples: SignalSample[] | null): void {
		const next = { ...this.signalSamples };
		if (samples) {
			next[key] = samples;
		} else {
			delete next[key];
		}
		this.signalSamples = next;
	}

	private async decodeSignal(key: PlotSignalKey): Promise<void> {
		const trace = traceFile.entry;
		const target = findSignalTarget(key);
		if (!trace || !target) return;

		this.setDecodeError(key, null);
		this.decodingSignalKeys = arrayWith(this.decodingSignalKeys, key, true);

		try {
			const samples = await getSignalValues(
				target.file.handle,
				trace.handle,
				target.message.name,
				target.signal.name
			);

			if (!this.isSignalSelected(key) || traceFile.entry !== trace || !findSignalTarget(key)) {
				return;
			}

			this.setSignalSamples(key, samples);
		} catch (error) {
			if (this.isSignalSelected(key) && traceFile.entry === trace && findSignalTarget(key)) {
				this.setDecodeError(key, error instanceof Error ? error.message : 'Signal decode failed');
			}
		} finally {
			this.decodingSignalKeys = arrayWith(this.decodingSignalKeys, key, false);
		}
	}

	private setDecodeError(key: PlotSignalKey, error: string | null): void {
		const next = { ...this.decodeErrors };
		if (error) {
			next[key] = error;
		} else {
			delete next[key];
		}
		this.decodeErrors = next;
	}
}

type PlotSignalData = {
	samples: SignalSample[] | undefined;
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
		samples: data.samples ?? null,
		isDecoding: data.isDecoding,
		decodeError: data.decodeError ?? null
	};
}

type SignalTarget = {
	file: DbcFileEntry;
	message: DbcMessage;
	signal: DbcSignal;
};

function findSignalTarget(key: PlotSignalKey): SignalTarget | null {
	for (const file of dbcFiles.files) {
		for (const message of file.catalog.messages) {
			for (const signal of message.signals) {
				if (signalKey(file.id, message.name, signal.name) === key) {
					return { file, message, signal };
				}
			}
		}
	}

	return null;
}

function displayDbcName(fileName: string): string {
	return fileName.replace(/\.dbc$/i, '');
}

function arrayWith(values: string[], value: string, include: boolean): string[] {
	if (include) return values.includes(value) ? values : [...values, value];
	return values.filter((candidate) => candidate !== value);
}

export const plotData = new PlotDataStore();
