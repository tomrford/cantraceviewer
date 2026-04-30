import { dbcFiles, signalKey } from '$lib/stores/dbc-files.svelte.js';
import type { DbcMessage, DbcSignal, DbcValueDescription } from '$lib/dbc-wasm.js';

export type PlotSignalKey = string;

export type DecodedSignalBlob = {
	bytes: Uint8Array;
	sampleCount: number;
};

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
	decoded: DecodedSignalBlob | null;
};

class PlotDataStore {
	selectedSignalKeys = $state<PlotSignalKey[]>([]);
	decodedSignalBlobs = $state<Record<PlotSignalKey, DecodedSignalBlob>>({});

	signals = $derived.by<PlotSignal[]>(() => {
		const selected = new Set(this.selectedSignalKeys);
		const signals: PlotSignal[] = [];

		for (const file of dbcFiles.files) {
			for (const message of file.catalog.messages) {
				for (const signal of message.signals) {
					const key = signalKey(file.id, message.name, signal.name);
					if (!selected.has(key)) continue;

					signals.push(
						plotSignal(file.id, file.file.name, message, signal, this.decodedSignalBlobs[key])
					);
				}
			}
		}

		return signals;
	});

	isSignalSelected(key: PlotSignalKey): boolean {
		return this.selectedSignalKeys.includes(key);
	}

	toggleSignal(key: PlotSignalKey): void {
		this.selectedSignalKeys = arrayWith(this.selectedSignalKeys, key, !this.isSignalSelected(key));
	}

	deselectDbcFile(dbcFileId: string): void {
		const liveKeys = new Set(
			dbcFiles.sidebarFiles
				.find((file) => file.id === dbcFileId)
				?.signals.map((signal) => signal.key) ?? []
		);

		this.selectedSignalKeys = this.selectedSignalKeys.filter((key) => !liveKeys.has(key));
		this.decodedSignalBlobs = Object.fromEntries(
			Object.entries(this.decodedSignalBlobs).filter(([key]) => !liveKeys.has(key))
		);
	}

	setDecodedSignalBlob(key: PlotSignalKey, decoded: DecodedSignalBlob | null): void {
		const next = { ...this.decodedSignalBlobs };
		if (decoded) {
			next[key] = decoded;
		} else {
			delete next[key];
		}
		this.decodedSignalBlobs = next;
	}
}

function plotSignal(
	dbcFileId: string,
	sourceFileName: string,
	message: DbcMessage,
	signal: DbcSignal,
	decoded: DecodedSignalBlob | undefined
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
		decoded: decoded ?? null
	};
}

function displayDbcName(fileName: string): string {
	return fileName.replace(/\.dbc$/i, '');
}

function arrayWith(values: string[], value: string, include: boolean): string[] {
	if (include) return values.includes(value) ? values : [...values, value];
	return values.filter((candidate) => candidate !== value);
}

export const plotData = new PlotDataStore();
