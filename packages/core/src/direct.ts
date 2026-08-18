/// <reference lib="dom" />

import { createHandleRegistry } from './handles.ts';
import { initSync, Dbc as WasmDbc, Trace as WasmTrace } from './wasm-bindgen/cantraceviewer.js';
import type {
	DbcHandle,
	DbcMessageIdentity,
	DecodedSignalSeries,
	Mf4SignalCatalog,
	OpenDbcResult,
	OpenTraceResult,
	ParsedDbc,
	TraceHandle,
	TraceMetadata,
	TraceType
} from './types.ts';

export type * from './types.ts';

/** WASM bytes or an already compiled module. Compilation of bytes is synchronous. */
export type DirectWasmInput = BufferSource | WebAssembly.Module;

/** Package-local WASM asset URL. Read, fetch, or compile it before synchronous initialization. */
export const wasmUrl = new URL('./wasm-bindgen/cantraceviewer_bg.wasm', import.meta.url);

/**
 * Fully synchronous in-process client. Every operation compiles, parses, or decodes on the calling
 * thread and returns its result directly; nothing here creates a Worker or a promise.
 *
 * Use it only where blocking is acceptable: inside a Worker or worker thread, in a dedicated
 * process, in benchmarks, or in tests. Do not call it on a browser UI thread or an Electron main
 * thread; use the asynchronous browser or Node clients there.
 */
export type DirectClient = {
	openDbc(text: string): OpenDbcResult;
	/** Idempotent for handles this client issued; repeat calls do nothing. */
	closeDbc(handle: DbcHandle): void;
	openTrace(traceType: TraceType, bytes: Uint8Array): OpenTraceResult;
	/** Idempotent for handles this client issued; repeat calls do nothing. */
	closeTrace(handle: TraceHandle): void;
	/**
	 * Decode one DBC signal over the trace's raw frames. Both returned arrays are views over one
	 * exactly-sized ArrayBuffer, so transports can transfer the result without copying.
	 */
	getSignalValues(
		dbcHandle: DbcHandle,
		traceHandle: TraceHandle,
		messageIdentity: DbcMessageIdentity,
		signalName: string
	): DecodedSignalSeries;
	/** Read one signal the trace already carries decoded, identified by its MF4 catalog id. */
	getMf4SignalValues(traceHandle: TraceHandle, signalId: number): DecodedSignalSeries;
	/** Idempotent. Frees every handle this client still owns. */
	close(): void;
};

/**
 * Create a synchronous client over one WASM instance. WASM initialization happens once per
 * JavaScript realm: later clients reuse that instance and ignore their input, but each client owns
 * its own handles. Fetching or reading the bytes is the caller's job and can be asynchronous; this
 * call is not.
 */
export function createDirectClient(wasm: DirectWasmInput): DirectClient {
	// The generated `initSync` returns the existing instance when it is already initialized.
	withWasmErrors(() => initSync({ module: wasm }));

	const handles = createHandleRegistry<{ dbc: WasmDbc; trace: WasmTrace }>();
	let clientClosed = false;

	function assertClientOpen(): void {
		if (clientClosed) throw new Error('client is closed');
	}

	return {
		openDbc(text) {
			assertClientOpen();
			const dbc = withWasmErrors(() => WasmDbc.parse(text));
			try {
				const catalog = JSON.parse(withWasmErrors(() => dbc.catalogJson())) as ParsedDbc;
				return { handle: handles.issue('dbc', dbc), catalog };
			} catch (error) {
				dbc.free();
				throw error;
			}
		},
		closeDbc(handle) {
			freeHandle(handles.release('dbc', handle));
		},
		openTrace(traceType, bytes) {
			assertClientOpen();
			const trace = withWasmErrors(() => parseTrace(traceType, bytes));
			try {
				const metadata: TraceMetadata = {
					measurementStartMs: trace.measurementStartMs ?? null,
					validMessageCount: trace.validMessageCount,
					skippedLineCount: trace.skippedLineCount,
					durationNs: trace.durationNs ?? null
				};
				const isMf4 = traceType === 'mf4';
				const hasRawFrames = trace.hasRawFrames;
				const mf4Catalog = isMf4
					? (JSON.parse(withWasmErrors(() => trace.mf4CatalogJson())) as Mf4SignalCatalog)
					: null;
				const embeddedDbcs = isMf4
					? (JSON.parse(
							withWasmErrors(() => trace.mf4EmbeddedDbcsJson())
						) as OpenTraceResult['embeddedDbcs'])
					: [];
				const warnings = isMf4
					? (JSON.parse(withWasmErrors(() => trace.mf4WarningsJson())) as string[])
					: [];
				return {
					handle: handles.issue('trace', trace),
					metadata,
					hasRawFrames,
					mf4Catalog,
					embeddedDbcs,
					warnings
				};
			} catch (error) {
				trace.free();
				throw error;
			}
		},
		closeTrace(handle) {
			freeHandle(handles.release('trace', handle));
		},
		getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName) {
			assertClientOpen();
			const dbc = handles.payload('dbc', dbcHandle);
			const trace = handles.payload('trace', traceHandle);
			return unpackSeries(
				withWasmErrors(() =>
					dbc.decodeSignal(
						trace,
						messageIdentity.canId,
						messageIdentity.isExtended,
						messageIdentity.sizeBytes,
						signalName
					)
				)
			);
		},
		getMf4SignalValues(traceHandle, signalId) {
			assertClientOpen();
			const trace = handles.payload('trace', traceHandle);
			return unpackSeries(withWasmErrors(() => trace.decodeMf4Signal(signalId)));
		},
		close() {
			if (clientClosed) return;
			clientClosed = true;
			let firstError: unknown;
			for (const payload of handles.releaseAll()) {
				try {
					freeHandle(payload);
				} catch (error) {
					firstError ??= error;
				}
			}
			if (firstError) throw firstError;
		}
	};
}

function freeHandle(payload: WasmDbc | WasmTrace | null): void {
	if (payload) withWasmErrors(() => payload.free());
}

function parseTrace(traceType: TraceType, bytes: Uint8Array): WasmTrace {
	switch (traceType) {
		case 'asc':
			return WasmTrace.parseAsc(bytes);
		case 'trc':
			return WasmTrace.parseTrc(bytes);
		case 'blf':
			return WasmTrace.parseBlf(bytes);
		case 'mf4':
			return WasmTrace.parseMf4(bytes);
	}
}

function unpackSeries(packed: Float64Array): DecodedSignalSeries {
	const count = packed.length / 2;
	return {
		timesMs: packed.subarray(0, count),
		values: packed.subarray(count)
	};
}

function withWasmErrors<T>(operation: () => T): T {
	try {
		return operation();
	} catch (error) {
		throw normalizeWasmError(error);
	}
}

function normalizeWasmError(error: unknown): Error {
	if (error instanceof WebAssembly.RuntimeError) {
		return new Error(`WebAssembly execution failed: ${error.message}`);
	}
	if (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.LinkError) {
		return new Error(`WebAssembly failed to load: ${error.message}`);
	}
	return error instanceof Error ? error : new Error(String(error));
}
