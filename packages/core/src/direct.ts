import initWasm, { Dbc as WasmDbc, Trace as WasmTrace } from './wasm-bindgen/cantraceviewer.js';
import type {
	DbcHandle,
	DbcMessageIdentity,
	DecodedSignalSeries,
	Mf4SignalCatalog,
	ParsedDbc,
	TraceHandle,
	TraceMetadata,
	TraceType
} from './types.js';

export type * from './types.js';

export type DirectWasmInput = BufferSource | WebAssembly.Module;

/**
 * Direct methods return promises for API parity. Their CPU work is synchronous in the caller's
 * execution context; this entry point does not create a Worker.
 */
export type DirectClient = {
	openDbc(text: string): Promise<{ handle: DbcHandle; catalog: ParsedDbc }>;
	closeDbc(handle: DbcHandle): Promise<void>;
	openTrace(traceType: TraceType, bytes: Uint8Array): Promise<TraceHandle>;
	closeTrace(handle: TraceHandle): Promise<void>;
	getSignalValues(
		dbcHandle: DbcHandle,
		traceHandle: TraceHandle,
		messageIdentity: DbcMessageIdentity,
		signalName: string
	): Promise<DecodedSignalSeries>;
	getMf4SignalValues(traceHandle: TraceHandle, signalId: number): Promise<DecodedSignalSeries>;
	close(): Promise<void>;
};

const HandleState = Symbol('CAN Trace Viewer handle state');

type Owner = symbol;

/** Class identity keeps deep-reactive stores from proxying private handle state. */
class DbcState {
	readonly kind = 'dbc';
	closed = false;

	constructor(
		readonly owner: Owner,
		readonly wasm: WasmDbc
	) {}
}

class TraceState {
	readonly kind = 'trace';
	closed = false;

	constructor(
		readonly owner: Owner,
		readonly wasm: WasmTrace
	) {}
}

type State = DbcState | TraceState;
type RuntimeHandle = { [HandleState]?: State };

let initialization: Promise<void> | null = null;
let nextHandleId = 1;

export async function createDirectClient(module: DirectWasmInput): Promise<DirectClient> {
	await initialize(module);

	const owner: Owner = Symbol('CAN Trace Viewer direct client owner');
	const states = new Set<State>();
	let clientClosed = false;

	function assertClientOpen(): void {
		if (clientClosed) throw new Error('client is closed');
	}

	function stateFor<T extends State>(kind: T['kind'], handle: DbcHandle | TraceHandle): T {
		const state = (handle as RuntimeHandle)[HandleState];
		if (!state || state.owner !== owner || state.kind !== kind) {
			throw new Error(`${kind} handle does not belong to this client`);
		}
		if (state.closed) throw new Error(`${kind} handle is closed`);
		return state as T;
	}

	function closeState(state: State): void {
		if (state.closed) return;
		state.closed = true;
		states.delete(state);
		withWasmErrors(() => state.wasm.free());
	}

	function closeHandle(kind: State['kind'], handle: DbcHandle | TraceHandle): void {
		const state = (handle as RuntimeHandle)[HandleState];
		if (!state || state.owner !== owner || state.kind !== kind) {
			throw new Error(`${kind} handle does not belong to this client`);
		}
		closeState(state);
	}

	return {
		async openDbc(text) {
			assertClientOpen();
			const wasm = withWasmErrors(() => WasmDbc.parse(text));
			try {
				const catalog = JSON.parse(withWasmErrors(() => wasm.catalogJson())) as ParsedDbc;
				const state = new DbcState(owner, wasm);
				states.add(state);
				return {
					handle: { id: nextHandleId++, [HandleState]: state } as unknown as DbcHandle,
					catalog
				};
			} catch (error) {
				wasm.free();
				throw error;
			}
		},
		async closeDbc(handle) {
			closeHandle('dbc', handle);
		},
		async openTrace(traceType, bytes) {
			assertClientOpen();
			const wasm = withWasmErrors(() => parseTrace(traceType, bytes));
			try {
				const metadata: TraceMetadata = {
					measurementStartMs: wasm.measurementStartMs ?? null,
					validMessageCount: wasm.validMessageCount,
					skippedLineCount: wasm.skippedLineCount,
					durationNs: wasm.durationNs ?? null
				};
				const mf4Catalog =
					traceType === 'mf4'
						? (JSON.parse(withWasmErrors(() => wasm.mf4CatalogJson())) as Mf4SignalCatalog)
						: null;
				const embeddedDbcs =
					traceType === 'mf4'
						? (JSON.parse(
								withWasmErrors(() => wasm.mf4EmbeddedDbcsJson())
							) as TraceHandle['embeddedDbcs'])
						: [];
				const warnings =
					traceType === 'mf4'
						? (JSON.parse(withWasmErrors(() => wasm.mf4WarningsJson())) as string[])
						: [];
				const state = new TraceState(owner, wasm);
				states.add(state);
				return {
					id: nextHandleId++,
					metadata,
					hasRawFrames: wasm.hasRawFrames,
					mf4Catalog,
					embeddedDbcs,
					warnings,
					// Object spread must copy this enumerable symbol and retain the shared state.
					[HandleState]: state
				} as unknown as TraceHandle;
			} catch (error) {
				wasm.free();
				throw error;
			}
		},
		async closeTrace(handle) {
			closeHandle('trace', handle);
		},
		async getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName) {
			assertClientOpen();
			const dbc = stateFor<DbcState>('dbc', dbcHandle);
			const trace = stateFor<TraceState>('trace', traceHandle);
			const packed = withWasmErrors(() =>
				dbc.wasm.decodeSignal(
					trace.wasm,
					messageIdentity.canId,
					messageIdentity.isExtended,
					messageIdentity.sizeBytes,
					signalName
				)
			);
			return unpackSeries(packed);
		},
		async getMf4SignalValues(traceHandle, signalId) {
			assertClientOpen();
			const trace = stateFor<TraceState>('trace', traceHandle);
			return unpackSeries(withWasmErrors(() => trace.wasm.decodeMf4Signal(signalId)));
		},
		async close() {
			if (clientClosed) return;
			clientClosed = true;
			let firstError: unknown;
			for (const state of states) {
				try {
					closeState(state);
				} catch (error) {
					firstError ??= error;
				}
			}
			if (firstError) throw firstError;
		}
	};
}

async function initialize(module: DirectWasmInput): Promise<void> {
	initialization ??= initWasm({ module_or_path: module }).then(() => undefined);
	const pending = initialization;
	try {
		await pending;
	} catch (error) {
		if (initialization === pending) initialization = null;
		throw normalizeWasmError(error);
	}
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

function normalizeWasmError(error: unknown): unknown {
	if (error instanceof WebAssembly.RuntimeError) {
		return new Error(`WebAssembly execution failed: ${error.message}`);
	}
	if (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.LinkError) {
		return new Error(`WebAssembly failed to load: ${error.message}`);
	}
	return error;
}
