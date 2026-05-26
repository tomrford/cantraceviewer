import wasmUrl from '$lib/assets/cantraceviewer.wasm?url';
import type {
	TraceType,
	WasmWorkerBootFailed,
	WasmWorkerMessage,
	WasmWorkerReady,
	WasmWorkerRequest,
	WasmWorkerSuccess
} from '$lib/wasm-rpc.types.js';

type BootState = { status: 'loading' } | { status: 'ready' } | { status: 'failed'; error: string };

let bootState: BootState = { status: 'loading' };

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

type HandleEntry = {
	type: 'dbc' | 'trace';
	ptr: number;
};

type TraceFormatLabel = 'ASC' | 'TRC' | 'BLF';

const handles = new Map<string, HandleEntry>();
let nextHandleId = 0;

let wasmPromise: Promise<CanTraceViewerWasmExports> | null = null;

async function loadWasm(): Promise<CanTraceViewerWasmExports> {
	wasmPromise ??= WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).then((result) => {
		return result.instance.exports as CanTraceViewerWasmExports;
	});

	return wasmPromise;
}

function allocHandle(type: HandleEntry['type'], ptr: number): string {
	const handleId = String(nextHandleId++);
	handles.set(handleId, { type, ptr });
	return handleId;
}

function getHandle(handleId: string, type: HandleEntry['type']): number {
	const entry = handles.get(handleId);
	if (!entry || entry.type !== type) {
		throw new Error(`${type === 'dbc' ? 'DBC' : 'Trace'} handle not found`);
	}

	return entry.ptr;
}

function releaseHandle(handleId: string, type: HandleEntry['type']): number {
	const ptr = getHandle(handleId, type);
	handles.delete(handleId);
	return ptr;
}

function copyTextToWasm(wasm: CanTraceViewerWasmExports, text: string): number {
	return copyBytesToWasm(wasm, new TextEncoder().encode(text));
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
		const bytes = new Uint8Array(wasm.memory.buffer, ptr, len).slice();

		return new TextDecoder().decode(bytes);
	} finally {
		wasm.owned_bytes_free(ownedBytes);
	}
}

function readSignalSeries(
	wasm: CanTraceViewerWasmExports,
	ownedValues: number
): { timesMs: Float64Array; values: Float64Array; transfer: ArrayBuffer[] } {
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
				values: new Float64Array(0),
				transfer: []
			};
		}

		const valuesPtr = ptr + count * Float64Array.BYTES_PER_ELEMENT;
		const timesMs = new Float64Array(wasm.memory.buffer, ptr, count).slice();
		const values = new Float64Array(wasm.memory.buffer, valuesPtr, count).slice();

		return {
			timesMs,
			values,
			transfer: [timesMs.buffer, values.buffer]
		};
	} finally {
		wasm.owned_float64s_free(ownedValues);
	}
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

async function handleRequest(
	wasm: CanTraceViewerWasmExports,
	request: WasmWorkerRequest
): Promise<void> {
	try {
		switch (request.op) {
			case 'openDbc': {
				const inputBytes = copyTextToWasm(wasm, request.text);

				let ptr: number;
				try {
					ptr = wasm.dbc_parse(inputBytes);
				} finally {
					wasm.owned_bytes_free(inputBytes);
				}

				if (ptr === 0) {
					throw new Error('DBC parse failed');
				}

				respondSuccess(request.id, { handleId: allocHandle('dbc', ptr) });
				return;
			}
			case 'getDbcCatalog': {
				const ptr = getHandle(request.handleId, 'dbc');
				const jsonBytes = wasm.dbc_to_json(ptr);

				if (jsonBytes === 0) {
					throw new Error('DBC JSON export failed');
				}

				respondSuccess(request.id, { json: readOwnedText(wasm, jsonBytes) });
				return;
			}
			case 'closeDbc': {
				wasm.dbc_free(releaseHandle(request.handleId, 'dbc'));
				respondSuccess(request.id, null);
				return;
			}
			case 'openTrace': {
				const traceParser = parserForTraceType(wasm, request.traceType);
				const ptr = parseTraceBytes(wasm, request.bytes, traceParser.parse, traceParser.label);
				const handleId = allocHandle('trace', ptr);

				try {
					const jsonBytes = wasm.trace_to_metadata_json(ptr);
					if (jsonBytes === 0) {
						throw new Error('Trace metadata export failed');
					}

					respondSuccess(request.id, {
						handleId,
						metadataJson: readOwnedText(wasm, jsonBytes)
					});
				} catch (error) {
					wasm.trace_free(ptr);
					handles.delete(handleId);
					throw error;
				}
				return;
			}
			case 'getTraceMetadata': {
				const ptr = getHandle(request.handleId, 'trace');
				const jsonBytes = wasm.trace_to_metadata_json(ptr);

				if (jsonBytes === 0) {
					throw new Error('Trace metadata export failed');
				}

				respondSuccess(request.id, { json: readOwnedText(wasm, jsonBytes) });
				return;
			}
			case 'closeTrace': {
				wasm.trace_free(releaseHandle(request.handleId, 'trace'));
				respondSuccess(request.id, null);
				return;
			}
			case 'getSignalValues': {
				const dbcPtr = getHandle(request.dbcHandleId, 'dbc');
				const tracePtr = getHandle(request.traceHandleId, 'trace');
				let signalNameBytes = 0;

				try {
					signalNameBytes = copyTextToWasm(wasm, request.signalName);

					const series = wasm.get_trace_signal_values(
						dbcPtr,
						tracePtr,
						request.messageIdentity.canId,
						request.messageIdentity.isExtended,
						request.messageIdentity.sizeBytes,
						signalNameBytes
					);

					if (series === 0) {
						throw new Error('Signal decode failed');
					}

					const decoded = readSignalSeries(wasm, series);
					respondSuccess(
						request.id,
						{ timesMs: decoded.timesMs, values: decoded.values },
						decoded.transfer
					);
				} finally {
					if (signalNameBytes !== 0) {
						wasm.owned_bytes_free(signalNameBytes);
					}
				}
				return;
			}
		}
	} catch (error) {
		respondFailure(
			request.id,
			error instanceof Error ? error.message : 'WASM worker request failed'
		);
	}
}

function respondSuccess(id: string, result: unknown, transfer: Transferable[] = []): void {
	const response: WasmWorkerSuccess = { id, ok: true, result };
	self.postMessage(response, { transfer });
}

function respondFailure(id: string, error: string): void {
	const response = { id, ok: false, error } as const;
	self.postMessage(response);
}

function postBootStatus(): void {
	if (bootState.status === 'ready') {
		const ready: WasmWorkerReady = { type: 'ready' };
		self.postMessage(ready);
		return;
	}

	if (bootState.status === 'failed') {
		const failed: WasmWorkerBootFailed = { type: 'boot-failed', error: bootState.error };
		self.postMessage(failed);
	}
}

function markBootReady(): void {
	if (bootState.status === 'ready') {
		return;
	}

	bootState = { status: 'ready' };
	const ready: WasmWorkerReady = { type: 'ready' };
	self.postMessage(ready);
}

function markBootFailed(error: unknown): void {
	if (bootState.status === 'failed') {
		return;
	}

	const message = error instanceof Error ? error.message : 'WASM worker boot failed';
	bootState = { status: 'failed', error: message };
	const failed: WasmWorkerBootFailed = { type: 'boot-failed', error: message };
	self.postMessage(failed);
}

self.onmessage = (event: MessageEvent<WasmWorkerMessage | WasmWorkerRequest>) => {
	const message = event.data;

	if ('type' in message && message.type === 'sync') {
		postBootStatus();
		return;
	}

	const request = message as WasmWorkerRequest;
	void (async () => {
		try {
			const wasm = await loadWasm();
			await handleRequest(wasm, request);
		} catch (error) {
			respondFailure(
				request.id,
				error instanceof Error ? error.message : 'WASM worker request failed'
			);
		}
	})();
};

void loadWasm().then(markBootReady).catch(markBootFailed);
