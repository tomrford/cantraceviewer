import wasmUrl from '$lib/assets/cantraceviewer.wasm?url';
import { z } from 'zod';

export {
	ASC_MAX_FILE_BYTES,
	DBC_MAX_FILE_BYTES,
	assertFileSizeWithinLimit
} from '$lib/file-limits.js';

const DbcValueDescriptionSchema = z.object({
	rawValue: z.number(),
	label: z.string()
});

const DbcSignalSchema = z.object({
	name: z.string(),
	startBit: z.number(),
	bitLength: z.number(),
	endianness: z.string(),
	signedness: z.string(),
	factor: z.number(),
	offset: z.number(),
	minimum: z.number(),
	maximum: z.number(),
	unit: z.string(),
	valueType: z.string(),
	unsupportedMux: z.boolean(),
	receivers: z.array(z.string()),
	valueDescriptions: z.array(DbcValueDescriptionSchema)
});

const DbcMessageSchema = z.object({
	name: z.string(),
	dbcId: z.number(),
	canId: z.number(),
	isExtended: z.boolean(),
	isFd: z.boolean(),
	sizeBytes: z.number(),
	transmitter: z.string(),
	signals: z.array(DbcSignalSchema)
});

const ParsedDbcSchema = z.object({
	messages: z.array(DbcMessageSchema)
});

const TraceMetadataSchema = z.object({
	measurementStartMs: z.number().nullable(),
	validMessageCount: z.number(),
	durationNs: z.number().nullable()
});

export type DbcValueDescription = z.infer<typeof DbcValueDescriptionSchema>;
export type DbcSignal = z.infer<typeof DbcSignalSchema>;
export type DbcMessage = z.infer<typeof DbcMessageSchema>;
export type ParsedDbc = z.infer<typeof ParsedDbcSchema>;
export type TraceMetadata = z.infer<typeof TraceMetadataSchema>;
export type SignalSample = {
	timestampNs: bigint;
	value: number;
};

export type DbcHandle = {
	readonly ptr: number;
};

export type AscHandle = {
	readonly ptr: number;
};

type CanLogViewerWasmExports = {
	memory: WebAssembly.Memory;
	owned_bytes_alloc(len: number): number;
	dbc_parse(input: number): number;
	dbc_to_json(handle: number): number;
	dbc_free(handle: number): void;
	asc_parse(input: number): number;
	asc_to_metadata_json(handle: number): number;
	asc_free(handle: number): void;
	get_signal_values(
		dbcHandle: number,
		ascHandle: number,
		messageName: number,
		signalName: number
	): number;
	owned_bytes_ptr(bytes: number): number;
	owned_bytes_len(bytes: number): number;
	owned_bytes_free(bytes: number): void;
};

let wasmPromise: Promise<CanLogViewerWasmExports> | null = null;

async function loadWasm() {
	wasmPromise ??= WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).then((result) => {
		return result.instance.exports as CanLogViewerWasmExports;
	});

	return wasmPromise;
}

function copyTextToWasm(wasm: CanLogViewerWasmExports, text: string): number {
	const input = new TextEncoder().encode(text);
	const inputBytes = wasm.owned_bytes_alloc(input.byteLength);

	if (inputBytes === 0) {
		throw new Error('WASM allocation failed');
	}

	const inputPtr = wasm.owned_bytes_ptr(inputBytes);
	new Uint8Array(wasm.memory.buffer, inputPtr, input.byteLength).set(input);

	return inputBytes;
}

function readOwnedText(wasm: CanLogViewerWasmExports, ownedBytes: number): string {
	try {
		const ptr = wasm.owned_bytes_ptr(ownedBytes);
		const len = wasm.owned_bytes_len(ownedBytes);
		const bytes = new Uint8Array(wasm.memory.buffer, ptr, len).slice();

		return new TextDecoder().decode(bytes);
	} finally {
		wasm.owned_bytes_free(ownedBytes);
	}
}

function readSignalSamples(wasm: CanLogViewerWasmExports, ownedBytes: number): SignalSample[] {
	try {
		const ptr = wasm.owned_bytes_ptr(ownedBytes);
		const len = wasm.owned_bytes_len(ownedBytes);

		if (len % 16 !== 0) {
			throw new Error('Signal values export returned an invalid byte length');
		}

		const bytes = new Uint8Array(wasm.memory.buffer, ptr, len).slice();
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const samples: SignalSample[] = [];

		for (let offset = 0; offset < bytes.byteLength; offset += 16) {
			samples.push({
				timestampNs: view.getBigUint64(offset, true),
				value: view.getFloat64(offset + 8, true)
			});
		}

		return samples;
	} finally {
		wasm.owned_bytes_free(ownedBytes);
	}
}

export async function openDbc(text: string): Promise<DbcHandle> {
	const wasm = await loadWasm();
	const inputBytes = copyTextToWasm(wasm, text);

	let handle: number;
	try {
		handle = wasm.dbc_parse(inputBytes);
	} finally {
		wasm.owned_bytes_free(inputBytes);
	}

	if (handle === 0) {
		throw new Error('DBC parse failed');
	}

	return { ptr: handle };
}

export async function getDbcCatalog(handle: DbcHandle): Promise<ParsedDbc> {
	const wasm = await loadWasm();
	const jsonBytes = wasm.dbc_to_json(handle.ptr);

	if (jsonBytes === 0) {
		throw new Error('DBC JSON export failed');
	}

	return ParsedDbcSchema.parse(JSON.parse(readOwnedText(wasm, jsonBytes)));
}

export async function closeDbc(handle: DbcHandle): Promise<void> {
	const wasm = await loadWasm();
	wasm.dbc_free(handle.ptr);
}

export async function getSignalValues(
	dbcHandle: DbcHandle,
	ascHandle: AscHandle,
	messageName: string,
	signalName: string
): Promise<SignalSample[]> {
	const wasm = await loadWasm();
	let messageNameBytes = 0;
	let signalNameBytes = 0;
	try {
		messageNameBytes = copyTextToWasm(wasm, messageName);
		signalNameBytes = copyTextToWasm(wasm, signalName);

		const seriesBytes = wasm.get_signal_values(
			dbcHandle.ptr,
			ascHandle.ptr,
			messageNameBytes,
			signalNameBytes
		);
		if (seriesBytes === 0) {
			throw new Error('Signal decode failed');
		}

		return readSignalSamples(wasm, seriesBytes);
	} finally {
		if (signalNameBytes !== 0) {
			wasm.owned_bytes_free(signalNameBytes);
		}
		if (messageNameBytes !== 0) {
			wasm.owned_bytes_free(messageNameBytes);
		}
	}
}

export async function openAsc(text: string): Promise<AscHandle> {
	const wasm = await loadWasm();
	const inputBytes = copyTextToWasm(wasm, text);

	let handle: number;
	try {
		handle = wasm.asc_parse(inputBytes);
	} finally {
		wasm.owned_bytes_free(inputBytes);
	}

	if (handle === 0) {
		throw new Error('ASC parse failed');
	}

	return { ptr: handle };
}

export async function getAscMetadata(handle: AscHandle): Promise<TraceMetadata> {
	const wasm = await loadWasm();
	const jsonBytes = wasm.asc_to_metadata_json(handle.ptr);

	if (jsonBytes === 0) {
		throw new Error('ASC metadata export failed');
	}

	return TraceMetadataSchema.parse(JSON.parse(readOwnedText(wasm, jsonBytes)));
}

export async function closeAsc(handle: AscHandle): Promise<void> {
	const wasm = await loadWasm();
	wasm.asc_free(handle.ptr);
}
