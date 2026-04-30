import wasmUrl from '../../wasm/zig-out/bin/can_log_viewer.wasm?url';
import { z } from 'zod';

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
	frameCount: z.number()
});

export type DbcValueDescription = z.infer<typeof DbcValueDescriptionSchema>;
export type DbcSignal = z.infer<typeof DbcSignalSchema>;
export type DbcMessage = z.infer<typeof DbcMessageSchema>;
export type ParsedDbc = z.infer<typeof ParsedDbcSchema>;
export type TraceMetadata = z.infer<typeof TraceMetadataSchema>;

type CanLogViewerWasmExports = {
	memory: WebAssembly.Memory;
	owned_bytes_alloc(len: number): number;
	dbc_parse(input: number): number;
	dbc_to_json(handle: number): number;
	dbc_free(handle: number): void;
	asc_parse(input: number): number;
	asc_to_metadata_json(handle: number): number;
	asc_free(handle: number): void;
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

export async function parseDbcText(text: string): Promise<ParsedDbc> {
	const wasm = await loadWasm();
	const inputBytes = copyTextToWasm(wasm, text);

	let handle = 0;
	try {
		handle = wasm.dbc_parse(inputBytes);
	} finally {
		wasm.owned_bytes_free(inputBytes);
	}

	if (handle === 0) {
		throw new Error('DBC parse failed');
	}

	try {
		const jsonBytes = wasm.dbc_to_json(handle);

		if (jsonBytes === 0) {
			throw new Error('DBC JSON export failed');
		}

		return ParsedDbcSchema.parse(JSON.parse(readOwnedText(wasm, jsonBytes)));
	} finally {
		wasm.dbc_free(handle);
	}
}

export async function parseAscText(text: string): Promise<TraceMetadata> {
	const wasm = await loadWasm();
	const inputBytes = copyTextToWasm(wasm, text);

	let handle = 0;
	try {
		handle = wasm.asc_parse(inputBytes);
	} finally {
		wasm.owned_bytes_free(inputBytes);
	}

	if (handle === 0) {
		throw new Error('ASC parse failed');
	}

	try {
		const jsonBytes = wasm.asc_to_metadata_json(handle);

		if (jsonBytes === 0) {
			throw new Error('ASC metadata export failed');
		}

		return TraceMetadataSchema.parse(JSON.parse(readOwnedText(wasm, jsonBytes)));
	} finally {
		wasm.asc_free(handle);
	}
}
