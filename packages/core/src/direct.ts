/// <reference lib="dom" />

import { createHandleRegistry } from './handles.ts';
import { snapshotLimits, dbcBytes, assertByteLimit, type ParsingLimits } from './limits.ts';
import { initSync, Dbc as WasmDbc, Trace as WasmTrace } from './wasm-bindgen/cantraceviewer.js';
import type {
	DbcHandle,
	DbcMessageIdentity,
	RawSource,
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
export { DEFAULT_PARSING_LIMITS, type ParsingLimits } from './limits.ts';

/** WASM bytes or an already compiled module. Compilation of bytes is synchronous. */
export type DirectWasmInput = BufferSource | WebAssembly.Module;

/** Package-local WASM asset URL. Read, fetch, or compile it before synchronous initialization. */
export const wasmUrl = new URL('./wasm-bindgen/cantraceviewer_bg.wasm', import.meta.url);

/**
 * Synchronous client that blocks the calling thread. Use the asynchronous browser or Node
 * client on UI threads.
 */
export type DirectClient = {
	openDbc(input: Uint8Array | string): OpenDbcResult;
	/** Idempotent for this client's handles. */
	closeDbc(handle: DbcHandle): void;
	openTrace(traceType: TraceType, bytes: Uint8Array): OpenTraceResult;
	/** Idempotent for this client's handles. */
	closeTrace(handle: TraceHandle): void;
	/**
	 * Decodes a DBC signal from raw frames. Arrays share one exactly-sized ArrayBuffer.
	 */
	getSignalValues(
		dbcHandle: DbcHandle,
		traceHandle: TraceHandle,
		messageIdentity: DbcMessageIdentity,
		signalName: string,
		source?: RawSource
	): DecodedSignalSeries;
	/** Read one signal the trace already carries decoded, identified by its MF4 catalog id. */
	getMf4SignalValues(traceHandle: TraceHandle, signalId: number): DecodedSignalSeries;
	/** Idempotent. Frees every handle this client still owns. */
	close(): void;
};

/**
 * Initializes WASM once per JavaScript realm; later clients ignore their input and reuse it.
 * Each client owns its handles. Load the bytes before calling.
 */
export function createDirectClient(
	wasm: DirectWasmInput,
	inputLimits?: ParsingLimits
): DirectClient {
	const limits = snapshotLimits(inputLimits);
	initWasm(wasm);

	const handles = createHandleRegistry<{ dbc: WasmDbc; trace: WasmTrace }>();
	let clientClosed = false;

	function assertClientOpen(): void {
		if (clientClosed) throw new Error('client is closed');
	}

	return {
		openDbc(input) {
			assertClientOpen();
			const dbc = WasmDbc.parse(dbcBytes(input, limits.maxDbcBytes));
			try {
				const catalog = JSON.parse(dbc.catalogJson()) as ParsedDbc;
				const warnings = JSON.parse(dbc.warningsJson()) as OpenDbcResult['warnings'];
				return { handle: handles.issue('dbc', dbc), catalog, warnings };
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
			assertByteLimit(bytes.byteLength, limits.maxTraceInputBytes, 'Trace input');
			const trace = parseTrace(traceType, bytes, limits);
			try {
				const metadata: TraceMetadata = {
					rawMessages: JSON.parse(trace.rawMessagesJson()) as TraceMetadata['rawMessages'],
					measurementStartMs: trace.measurementStartMs ?? null,
					validMessageCount: trace.validMessageCount,
					skippedLineCount: trace.skippedLineCount,
					durationNs: trace.durationNs ?? null
				};
				const isMf4 = traceType === 'mf4';
				const hasRawFrames = trace.hasRawFrames;
				const mf4Catalog = isMf4 ? (JSON.parse(trace.mf4CatalogJson()) as Mf4SignalCatalog) : null;
				const embeddedDbcs = isMf4
					? (JSON.parse(trace.mf4EmbeddedDbcsJson()) as { name: string; text: string }[]).map(
							(dbc, index) => ({ ...dbc, bytes: trace.mf4EmbeddedDbcBytes(index) })
						)
					: [];
				const warnings = isMf4 ? (JSON.parse(trace.mf4WarningsJson()) as string[]) : [];
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
		getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName, source) {
			assertClientOpen();
			const dbc = handles.payload('dbc', dbcHandle);
			const trace = handles.payload('trace', traceHandle);
			if (
				source &&
				((source.channel !== null &&
					(!Number.isInteger(source.channel) || source.channel < 1 || source.channel > 65535)) ||
					!['unknown', 'rx', 'tx'].includes(source.direction))
			) {
				throw new Error(
					'Invalid raw source: channel must be null or 1–65535 and direction unknown, rx or tx'
				);
			}
			return unpackSeries(
				dbc.decodeSignal(
					trace,
					messageIdentity.canId,
					messageIdentity.isExtended,
					messageIdentity.sizeBytes,
					signalName,
					source?.channel ?? undefined,
					source ? { unknown: 0, rx: 1, tx: 2 }[source.direction] : undefined
				)
			);
		},
		getMf4SignalValues(traceHandle, signalId) {
			assertClientOpen();
			const trace = handles.payload('trace', traceHandle);
			return unpackSeries(trace.decodeMf4Signal(signalId));
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
	payload?.free();
}

function parseTrace(traceType: TraceType, bytes: Uint8Array, limits: ParsingLimits): WasmTrace {
	switch (traceType) {
		case 'asc':
			return WasmTrace.parseAsc(bytes);
		case 'trc':
			return WasmTrace.parseTrc(bytes);
		case 'blf':
			return WasmTrace.parseBlf(bytes, limits.maxTraceDataBytes);
		case 'mf4':
			return WasmTrace.parseMf4(bytes, limits.maxDbcBytes, limits.maxTraceDataBytes);
	}
}

function unpackSeries(packed: Float64Array): DecodedSignalSeries {
	const count = packed.length / 2;
	return {
		timesMs: packed.subarray(0, count),
		values: packed.subarray(count)
	};
}

function initWasm(wasm: DirectWasmInput): void {
	try {
		initSync({ module: wasm });
	} catch (error) {
		if (error instanceof WebAssembly.RuntimeError) {
			throw new Error(`WebAssembly execution failed: ${error.message}`, { cause: error });
		}
		if (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.LinkError) {
			throw new Error(`WebAssembly failed to load: ${error.message}`, { cause: error });
		}
		throw error;
	}
}
