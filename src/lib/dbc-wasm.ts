import wasmUrl from '../../wasm/zig-out/bin/can_log_viewer.wasm?url';

export type DbcValueDescription = {
	rawValue: number;
	label: string;
};

export type DbcSignal = {
	name: string;
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
	unsupportedMux: boolean;
	receivers: string[];
	valueDescriptions: DbcValueDescription[];
};

export type DbcMessage = {
	name: string;
	dbcId: number;
	canId: number;
	isExtended: boolean;
	isFd: boolean;
	sizeBytes: number;
	transmitter: string;
	signals: DbcSignal[];
};

export type ParsedDbc = {
	messages: DbcMessage[];
};

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

			return JSON.parse(json) as ParsedDbc;
		} finally {
			wasm.owned_bytes_free(jsonBytes);
		}
	} finally {
		wasm.dbc_free(handle);
	}
}
