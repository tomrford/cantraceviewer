/** WASM parse/decode adapter. File size limits: import from '$lib/file-limits.js'. */
import wasmUrl from '$lib/assets/cantraceviewer.wasm?url';
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
	validMessageCount: z.number(),
	durationNs: z.number().nullable()
});

export type DbcValueDescription = z.infer<typeof DbcValueDescriptionSchema>;
export type DbcSignal = z.infer<typeof DbcSignalSchema>;
export type DbcMessage = z.infer<typeof DbcMessageSchema>;
export type ParsedDbc = z.infer<typeof ParsedDbcSchema>;
export type TraceMetadata = z.infer<typeof TraceMetadataSchema>;
export type DecodedSignalSeries = {
	timesMs: Float64Array;
	values: Float64Array;
};
export type TraceType = 'asc' | 'trc' | 'blf';

declare const DbcHandleBrand: unique symbol;
declare const TraceHandleBrand: unique symbol;

/** Opaque DBC handle. Only this module constructs handles or reads their ids. */
export type DbcHandle = {
	readonly [DbcHandleBrand]: true;
	readonly id: number;
};

/** Opaque trace handle. Only this module constructs handles or reads their ids. */
export type TraceHandle = {
	readonly [TraceHandleBrand]: true;
	readonly id: number;
	readonly metadata: TraceMetadata;
};

type CanTraceViewerWasmExports = {
	memory: WebAssembly.Memory;
	owned_bytes_alloc(len: number): number;
	dbc_parse(input: number): number;
	dbc_to_json(handle: number): number;
	dbc_free(handle: number): void;
	asc_parse(input: number): number;
	trc_parse(input: number): number;
	blf_parse(input: number): number;
	trace_to_metadata_json(handle: number): number;
	trace_free(handle: number): void;
	get_trace_signal_values(
		dbcHandle: number,
		traceHandle: number,
		canId: number,
		isExtended: boolean,
		sizeBytes: number,
		signalName: number
	): number;
	owned_bytes_ptr(bytes: number): number;
	owned_bytes_len(bytes: number): number;
	owned_bytes_free(bytes: number): void;
	owned_float64s_ptr(values: number): number;
	owned_float64s_len(values: number): number;
	owned_float64s_free(values: number): void;
};

let wasmPromise: Promise<CanTraceViewerWasmExports> | null = null;

async function loadWasm() {
	wasmPromise ??= WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).then((result) => {
		return result.instance.exports as CanTraceViewerWasmExports;
	});

	return wasmPromise;
}

function copyTextToWasm(wasm: CanTraceViewerWasmExports, text: string): number {
	const input = new TextEncoder().encode(text);
	return copyBytesToWasm(wasm, input);
}

function copyBytesToWasm(wasm: CanTraceViewerWasmExports, input: Uint8Array): number {
	const inputBytes = wasm.owned_bytes_alloc(input.byteLength);

	if (inputBytes === 0) {
		throw new Error('WASM allocation failed');
	}

	const inputPtr = wasm.owned_bytes_ptr(inputBytes);
	new Uint8Array(wasm.memory.buffer, inputPtr, input.byteLength).set(input);

	return inputBytes;
}

function readOwnedText(wasm: CanTraceViewerWasmExports, ownedBytes: number): string {
	try {
		const ptr = wasm.owned_bytes_ptr(ownedBytes);
		const len = wasm.owned_bytes_len(ownedBytes);
		const bytes = new Uint8Array(wasm.memory.buffer, ptr, len);

		return new TextDecoder().decode(bytes);
	} finally {
		wasm.owned_bytes_free(ownedBytes);
	}
}

function readSignalSeries(
	wasm: CanTraceViewerWasmExports,
	ownedValues: number
): DecodedSignalSeries {
	try {
		const ptr = wasm.owned_float64s_ptr(ownedValues);
		const len = wasm.owned_float64s_len(ownedValues);

		if (len % 2 !== 0) {
			throw new Error('Signal values export returned an invalid length');
		}

		const count = len / 2;
		if (count === 0) {
			return {
				timesMs: new Float64Array(0),
				values: new Float64Array(0)
			};
		}

		const valuesPtr = ptr + count * Float64Array.BYTES_PER_ELEMENT;

		return {
			timesMs: new Float64Array(wasm.memory.buffer, ptr, count).slice(),
			values: new Float64Array(wasm.memory.buffer, valuesPtr, count).slice()
		};
	} finally {
		wasm.owned_float64s_free(ownedValues);
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

	return { id: handle } as DbcHandle;
}

export async function getDbcCatalog(handle: DbcHandle): Promise<ParsedDbc> {
	const wasm = await loadWasm();
	const jsonBytes = wasm.dbc_to_json(handle.id);

	if (jsonBytes === 0) {
		throw new Error('DBC JSON export failed');
	}

	return ParsedDbcSchema.parse(JSON.parse(readOwnedText(wasm, jsonBytes)));
}

export async function closeDbc(handle: DbcHandle): Promise<void> {
	const wasm = await loadWasm();
	wasm.dbc_free(handle.id);
}

export type DbcMessageIdentity = Pick<DbcMessage, 'canId' | 'isExtended' | 'sizeBytes'>;

export async function getSignalValues(
	dbcHandle: DbcHandle,
	trace: TraceHandle,
	messageIdentity: DbcMessageIdentity,
	signalName: string
): Promise<DecodedSignalSeries> {
	const wasm = await loadWasm();
	let signalNameBytes = 0;
	try {
		signalNameBytes = copyTextToWasm(wasm, signalName);

		const series = wasm.get_trace_signal_values(
			dbcHandle.id,
			trace.id,
			messageIdentity.canId,
			messageIdentity.isExtended,
			messageIdentity.sizeBytes,
			signalNameBytes
		);
		if (series === 0) {
			throw new Error('Signal decode failed');
		}

		return readSignalSeries(wasm, series);
	} finally {
		if (signalNameBytes !== 0) {
			wasm.owned_bytes_free(signalNameBytes);
		}
	}
}

async function getTraceMetadata(id: number): Promise<TraceMetadata> {
	const wasm = await loadWasm();
	const jsonBytes = wasm.trace_to_metadata_json(id);

	if (jsonBytes === 0) {
		throw new Error('Trace metadata export failed');
	}

	return TraceMetadataSchema.parse(JSON.parse(readOwnedText(wasm, jsonBytes)));
}

export async function closeTrace(trace: TraceHandle): Promise<void> {
	const wasm = await loadWasm();
	wasm.trace_free(trace.id);
}

export async function openTrace(traceType: TraceType, bytes: Uint8Array): Promise<TraceHandle> {
	const wasm = await loadWasm();
	const traceParser = parserForTraceType(wasm, traceType);
	const id = parseTraceBytes(wasm, bytes, traceParser.parse, traceParser.label);

	try {
		return {
			id,
			metadata: await getTraceMetadata(id)
		} as TraceHandle;
	} catch (error) {
		wasm.trace_free(id);
		throw error;
	}
}

function parseTraceBytes(
	wasm: CanTraceViewerWasmExports,
	bytes: Uint8Array,
	parse: (input: number) => number,
	formatLabel: TraceFormatLabel
): number {
	const inputBytes = copyBytesToWasm(wasm, bytes);

	let handle: number;
	try {
		handle = parse(inputBytes);
	} finally {
		wasm.owned_bytes_free(inputBytes);
	}

	if (handle === 0) {
		throw new Error(`${formatLabel} parse failed`);
	}

	return handle;
}

function parserForTraceType(
	wasm: CanTraceViewerWasmExports,
	traceType: TraceType
): { parse: (input: number) => number; label: TraceFormatLabel } {
	switch (traceType) {
		case 'asc':
			return { parse: wasm.asc_parse, label: 'ASC' };
		case 'trc':
			return { parse: wasm.trc_parse, label: 'TRC' };
		case 'blf':
			return { parse: wasm.blf_parse, label: 'BLF' };
	}
}

type TraceFormatLabel = 'ASC' | 'TRC' | 'BLF';
