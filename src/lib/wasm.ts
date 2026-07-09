/** Rust/WASM parse and decode adapter. File limits live in '$lib/file-limits.js'. */
import initWasm, {
	Dbc as WasmDbc,
	DecoderError,
	Trace as WasmTrace
} from './wasm-bindgen/cantraceviewer.js';
import wasmUrl from './wasm-bindgen/cantraceviewer_bg.wasm?url';
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
	skippedLineCount: z.number(),
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

export class WasmError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = 'WasmError';
		this.code = code;
	}
}

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
		const catalog = ParsedDbcSchema.parse(JSON.parse(withWasmErrors(() => wasm.catalogJson())));
		return {
			handle: newDbcHandle(wasm),
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

	if (packed.length % 2 !== 0) {
		throw new WasmError('InvalidSeries', 'Signal values export returned an invalid length');
	}

	const count = packed.length / 2;
	return {
		timesMs: packed.subarray(0, count),
		values: packed.subarray(count)
	};
}

export async function closeTrace(trace: TraceHandle): Promise<void> {
	await loadWasm();
	withWasmErrors(() => closeHandle(trace[HandleState]));
}

export async function openTrace(traceType: TraceType, bytes: Uint8Array): Promise<TraceHandle> {
	await loadWasm();
	const wasm = withWasmErrors(() => parseTrace(traceType, bytes));
	try {
		const metadata = withWasmErrors(() =>
			TraceMetadataSchema.parse({
				measurementStartMs: wasm.measurementStartMs ?? null,
				validMessageCount: wasm.validMessageCount,
				skippedLineCount: wasm.skippedLineCount,
				durationNs: wasm.durationNs ?? null
			})
		);

		return {
			id: nextHandleId++,
			metadata,
			[HandleState]: { closed: false, wasm }
		} as TraceHandle;
	} catch (error) {
		wasm.free();
		throw error;
	}
}

function newDbcHandle(wasm: WasmDbc): DbcHandle {
	return {
		id: nextHandleId++,
		[HandleState]: { closed: false, wasm }
	} as DbcHandle;
}

function parseTrace(traceType: TraceType, bytes: Uint8Array): WasmTrace {
	switch (traceType) {
		case 'asc':
			return WasmTrace.parseAsc(bytes);
		case 'trc':
			return WasmTrace.parseTrc(bytes);
		case 'blf':
			return WasmTrace.parseBlf(bytes);
	}
}

function assertHandleOpen<T extends DbcHandleState | TraceHandleState>(
	kind: 'dbc' | 'trace',
	state: T
): T {
	if (!state || state.closed) {
		throw new WasmError('HandleClosed', `${kind} handle is closed`);
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
	if (error instanceof DecoderError) {
		const code = error.code;
		const message = error.message;
		error.free();
		return new WasmError(code, message);
	}
	if (error instanceof WebAssembly.RuntimeError) {
		return new WasmError('WasmRuntimeError', error.message || 'WebAssembly execution failed');
	}
	if (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.LinkError) {
		return new WasmError('WasmLoadError', error.message || 'WebAssembly failed to load');
	}

	return error;
}
