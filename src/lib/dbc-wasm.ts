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

export type DbcValueDescription = z.infer<typeof DbcValueDescriptionSchema>;
export type DbcSignal = z.infer<typeof DbcSignalSchema>;
export type DbcMessage = z.infer<typeof DbcMessageSchema>;
export type ParsedDbc = z.infer<typeof ParsedDbcSchema>;

type DbcWasmExports = {
	memory: WebAssembly.Memory;
	alloc(len: number): number;
	free(ptr: number, len: number): void;
	dbc_parse(ptr: number, len: number): number;
	dbc_to_json(handle: number): number;
	dbc_free(handle: number): void;
	owned_bytes_ptr(bytes: number): number;
	owned_bytes_len(bytes: number): number;
	owned_bytes_free(bytes: number): void;
};

let wasmPromise: Promise<DbcWasmExports> | null = null;

async function loadWasm() {
	wasmPromise ??= WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).then((result) => {
		return result.instance.exports as DbcWasmExports;
	});

	return wasmPromise;
}

export async function parseDbcText(text: string): Promise<ParsedDbc> {
	const wasm = await loadWasm();
	const input = new TextEncoder().encode(text);
	const inputPtr = wasm.alloc(input.byteLength);

	if (inputPtr === 0) {
		throw new Error('WASM allocation failed');
	}

	new Uint8Array(wasm.memory.buffer, inputPtr, input.byteLength).set(input);

	const handle = wasm.dbc_parse(inputPtr, input.byteLength);
	wasm.free(inputPtr, input.byteLength);

	if (handle === 0) {
		throw new Error('DBC parse failed');
	}

	try {
		const jsonBytes = wasm.dbc_to_json(handle);

		if (jsonBytes === 0) {
			throw new Error('DBC JSON export failed');
		}

		try {
			const ptr = wasm.owned_bytes_ptr(jsonBytes);
			const len = wasm.owned_bytes_len(jsonBytes);
			const bytes = new Uint8Array(wasm.memory.buffer, ptr, len).slice();
			const json = new TextDecoder().decode(bytes);

			return ParsedDbcSchema.parse(JSON.parse(json));
		} finally {
			wasm.owned_bytes_free(jsonBytes);
		}
	} finally {
		wasm.dbc_free(handle);
	}
}
