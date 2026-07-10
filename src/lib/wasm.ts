/** Rust/WASM parse and decode adapter. File limits live in '$lib/file-limits.js'. */
import initWasm, { Dbc as WasmDbc, Trace as WasmTrace } from './wasm-bindgen/cantraceviewer.js';
import wasmUrl from './wasm-bindgen/cantraceviewer_bg.wasm?url';

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

/** Shape pinned by the `serializes_parsed_catalog` test in wasm/src/dbc/catalog.rs. */
export type ParsedDbc = {
	messages: DbcMessage[];
};

export type TraceMetadata = {
	measurementStartMs: number | null;
	validMessageCount: number;
	skippedLineCount: number;
	durationNs: number | null;
};

export type DecodedSignalSeries = {
	timesMs: Float64Array;
	values: Float64Array;
};

export type Mf4Signal = {
	id: number;
	name: string;
	unit: string;
};

export type Mf4SignalGroup = {
	name: string;
	signals: Mf4Signal[];
};

export type Mf4SignalCatalog = {
	groups: Mf4SignalGroup[];
};

export type EmbeddedDbc = {
	name: string;
	text: string;
};

export type TraceType = 'asc' | 'trc' | 'blf' | 'mf4';

declare const DbcHandleBrand: unique symbol;
declare const TraceHandleBrand: unique symbol;
const HandleState = Symbol('WASM handle state');

type DbcHandleState = {
	closed: boolean;
	wasm: WasmDbc;
};

type TraceHandleState = {
	closed: boolean;
	wasm: WasmTrace;
};

/** Opaque DBC handle. Only this module can access the generated Rust class. */
export type DbcHandle = {
	readonly [DbcHandleBrand]: true;
	readonly [HandleState]: DbcHandleState;
	readonly id: number;
};

/** Opaque trace handle. The state object survives TraceFileEntry object spreads. */
export type TraceHandle = {
	readonly [TraceHandleBrand]: true;
	readonly [HandleState]: TraceHandleState;
	readonly id: number;
	readonly metadata: TraceMetadata;
	readonly hasRawFrames: boolean;
	readonly mf4Catalog: Mf4SignalCatalog | null;
	readonly embeddedDbcs: EmbeddedDbc[];
	readonly warnings: string[];
};

let wasmPromise: ReturnType<typeof initWasm> | null = null;
let nextHandleId = 1;

async function loadWasm(): Promise<void> {
	wasmPromise ??= initWasm({ module_or_path: wasmUrl });
	try {
		await wasmPromise;
	} catch (error) {
		wasmPromise = null;
		throw normalizeWasmError(error);
	}
}

export async function openDbc(text: string): Promise<{ handle: DbcHandle; catalog: ParsedDbc }> {
	await loadWasm();
	const wasm = withWasmErrors(() => WasmDbc.parse(text));

	try {
		const catalog = JSON.parse(withWasmErrors(() => wasm.catalogJson())) as ParsedDbc;
		return {
			handle: {
				id: nextHandleId++,
				[HandleState]: { closed: false, wasm }
			} as DbcHandle,
			catalog
		};
	} catch (error) {
		wasm.free();
		throw error;
	}
}

export async function closeDbc(handle: DbcHandle): Promise<void> {
	await loadWasm();
	withWasmErrors(() => closeHandle(handle[HandleState]));
}

export type DbcMessageIdentity = Pick<DbcMessage, 'canId' | 'isExtended' | 'sizeBytes'>;

export async function getSignalValues(
	dbcHandle: DbcHandle,
	trace: TraceHandle,
	messageIdentity: DbcMessageIdentity,
	signalName: string
): Promise<DecodedSignalSeries> {
	await loadWasm();
	const dbcState = assertHandleOpen('dbc', dbcHandle[HandleState]);
	const traceState = assertHandleOpen('trace', trace[HandleState]);
	const packed = withWasmErrors(() =>
		dbcState.wasm.decodeSignal(
			traceState.wasm,
			messageIdentity.canId,
			messageIdentity.isExtended,
			messageIdentity.sizeBytes,
			signalName
		)
	);

	const count = packed.length / 2;
	return unpackSeries(packed, count);
}

export async function getMf4SignalValues(
	trace: TraceHandle,
	signalId: number
): Promise<DecodedSignalSeries> {
	await loadWasm();
	const traceState = assertHandleOpen('trace', trace[HandleState]);
	const packed = withWasmErrors(() => traceState.wasm.decodeMf4Signal(signalId));
	return unpackSeries(packed, packed.length / 2);
}

export async function closeTrace(trace: TraceHandle): Promise<void> {
	await loadWasm();
	withWasmErrors(() => closeHandle(trace[HandleState]));
}

export async function openTrace(traceType: TraceType, bytes: Uint8Array): Promise<TraceHandle> {
	await loadWasm();
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
				? (JSON.parse(withWasmErrors(() => wasm.mf4EmbeddedDbcsJson())) as EmbeddedDbc[])
				: [];
		const warnings =
			traceType === 'mf4'
				? (JSON.parse(withWasmErrors(() => wasm.mf4WarningsJson())) as string[])
				: [];

		return {
			id: nextHandleId++,
			metadata,
			hasRawFrames: wasm.hasRawFrames,
			mf4Catalog,
			embeddedDbcs,
			warnings,
			[HandleState]: { closed: false, wasm }
		} as TraceHandle;
	} catch (error) {
		wasm.free();
		throw error;
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

function unpackSeries(packed: Float64Array, count: number): DecodedSignalSeries {
	return {
		timesMs: packed.subarray(0, count),
		values: packed.subarray(count)
	};
}

function assertHandleOpen<T extends DbcHandleState | TraceHandleState>(
	kind: 'dbc' | 'trace',
	state: T
): T {
	if (!state || state.closed) {
		throw new Error(`${kind} handle is closed`);
	}

	return state;
}

function closeHandle(state: DbcHandleState | TraceHandleState | undefined): void {
	if (!state || state.closed) return;

	state.closed = true;
	state.wasm.free();
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
