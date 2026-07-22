import type {
	OpenDbcResult,
	OpenTraceResult,
	SeriesPayload,
	WireError,
	WorkerRequest,
	WorkerRequestBody,
	WorkerResponse
} from './protocol.js';
import type {
	DbcHandle,
	DbcMessageIdentity,
	DecodedSignalSeries,
	ParsedDbc,
	TraceHandle,
	TraceType
} from './types.js';

/**
 * Async CAN trace client backed by one dedicated module Web Worker. Every method is genuine
 * worker RPC; the worker executes requests strictly serially in call order. Worker startup or
 * crash failure is fatal for the client: every pending and future operation rejects, every
 * handle is invalidated, and the worker is terminated without restart.
 */
export type CanTraceClient = {
	openDbc(text: string): Promise<{ handle: DbcHandle; catalog: ParsedDbc }>;
	/** Idempotent for handles this client issued; repeat calls resolve without effect. */
	closeDbc(handle: DbcHandle): Promise<void>;
	/**
	 * Parse one trace. `buffer` must be the exact ArrayBuffer holding the file bytes: it is
	 * transferred to the worker and detached in the caller, and it stays consumed even when
	 * parsing fails. Typed-array views are rejected rather than silently copied.
	 */
	openTrace(traceType: TraceType, buffer: ArrayBuffer): Promise<TraceHandle>;
	/** Idempotent for handles this client issued; repeat calls resolve without effect. */
	closeTrace(handle: TraceHandle): Promise<void>;
	getSignalValues(
		dbcHandle: DbcHandle,
		traceHandle: TraceHandle,
		messageIdentity: DbcMessageIdentity,
		signalName: string
	): Promise<DecodedSignalSeries>;
	getMf4SignalValues(traceHandle: TraceHandle, signalId: number): Promise<DecodedSignalSeries>;
	/**
	 * Idempotent. Queues worker-side cleanup behind every previously posted operation, waits for
	 * its acknowledgement, invalidates every handle, then terminates the worker.
	 */
	close(): Promise<void>;
};

/** Worker surface the client depends on; production uses a real module Worker. @internal */
export type ClientWorkerEvent = { data?: unknown; message?: string };

/** @internal */
export type ClientWorker = {
	postMessage(message: WorkerRequest, transfer: Transferable[]): void;
	addEventListener(
		type: 'message' | 'error' | 'messageerror',
		listener: (event: ClientWorkerEvent) => void
	): void;
	terminate(): void;
};

const HandleState = Symbol('CAN Trace Viewer handle state');

type Owner = symbol;
type HandleKind = 'dbc' | 'trace';

/** Class identity keeps deep-reactive stores from proxying this private state object. */
class State {
	closed = false;

	constructor(
		readonly kind: HandleKind,
		readonly owner: Owner,
		readonly wireId: number
	) {}
}

type RuntimeHandle = { [HandleState]?: State };

/**
 * Create a client backed by a new dedicated module Worker. Call in the browser only; nothing is
 * instantiated at module import time, so importing this package is SSR/prerender safe.
 */
export async function createCanTraceClient(): Promise<CanTraceClient> {
	if (typeof Worker === 'undefined') {
		throw new Error('createCanTraceClient requires Web Worker support; call it in the browser');
	}
	// Keep this constructor call in literal `new Worker(new URL(...), ...)` form so bundlers
	// detect it and emit the worker entry chunk.
	return createCanTraceClientForWorker(
		() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
	);
}

/** Internal seam for deterministic tests; not exported from the package root. @internal */
export async function createCanTraceClientForWorker(
	createWorker: () => ClientWorker
): Promise<CanTraceClient> {
	const worker = createWorker();
	const owner: Owner = Symbol('CAN Trace Viewer client owner');
	const states = new Set<State>();
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }
	>();
	// Request IDs are never recycled.
	let nextRequestId = 1;
	let fatalError: Error | null = null;
	let closePromise: Promise<void> | null = null;

	let ready!: { resolve: () => void; reject: (reason: unknown) => void };
	const readyPromise = new Promise<void>((resolve, reject) => {
		ready = { resolve, reject };
	});

	worker.addEventListener('message', (event) => {
		const response = event.data as WorkerResponse;
		if (response.type === 'ready') {
			ready.resolve();
			return;
		}
		if (response.type === 'boot-error') {
			fail(fromWireError(response.error));
			return;
		}
		const entry = pending.get(response.id);
		if (!entry) return;
		pending.delete(response.id);
		if (response.type === 'ok') entry.resolve(response.result);
		else entry.reject(fromWireError(response.error));
	});
	worker.addEventListener('error', (event) => {
		fail(new Error(`worker crashed${event.message ? `: ${event.message}` : ''}`));
	});
	worker.addEventListener('messageerror', () => {
		fail(new Error('worker message failed to deserialize'));
	});

	/** Worker failure is terminal for this client: nothing ever restarts the worker. */
	function fail(error: Error): void {
		if (fatalError) return;
		fatalError = error;
		invalidateHandles();
		const entries = [...pending.values()];
		pending.clear();
		for (const entry of entries) entry.reject(error);
		worker.terminate();
		ready.reject(error);
	}

	function invalidateHandles(): void {
		for (const state of states) state.closed = true;
		states.clear();
	}

	function send<T>(body: WorkerRequestBody, transfer: Transferable[]): Promise<T> {
		if (fatalError) return Promise.reject(fatalError);
		const id = nextRequestId++;
		return new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			try {
				worker.postMessage({ ...body, id } as WorkerRequest, transfer);
			} catch (error) {
				pending.delete(id);
				reject(error);
			}
		});
	}

	function assertOpen(): void {
		if (fatalError) throw fatalError;
		if (closePromise) throw new Error('client is closed');
	}

	function ownedState(kind: HandleKind, handle: DbcHandle | TraceHandle): State {
		const state = (handle as RuntimeHandle)[HandleState];
		if (!state || state.owner !== owner || state.kind !== kind) {
			throw new Error(`${kind} handle does not belong to this client`);
		}
		return state;
	}

	function liveState(kind: HandleKind, handle: DbcHandle | TraceHandle): State {
		const state = ownedState(kind, handle);
		if (state.closed) throw new Error(`${kind} handle is closed`);
		return state;
	}

	async function closeHandle(kind: HandleKind, handle: DbcHandle | TraceHandle): Promise<void> {
		const state = ownedState(kind, handle);
		if (state.closed) return;
		state.closed = true;
		states.delete(state);
		// After a fatal failure or client close, worker-side cleanup already happened or the
		// whole direct client is being torn down; only the local mark is needed.
		if (fatalError || closePromise) return;
		await send<null>(
			kind === 'dbc'
				? { op: 'closeDbc', dbcId: state.wireId }
				: { op: 'closeTrace', traceId: state.wireId },
			[]
		);
	}

	await readyPromise;

	return {
		async openDbc(text) {
			assertOpen();
			const { dbcId, catalog } = await send<OpenDbcResult>({ op: 'openDbc', text }, []);
			const state = new State('dbc', owner, dbcId);
			states.add(state);
			return {
				// Object spread must copy this enumerable symbol and retain the shared state.
				handle: { id: dbcId, [HandleState]: state } as unknown as DbcHandle,
				catalog
			};
		},
		async closeDbc(handle) {
			await closeHandle('dbc', handle);
		},
		async openTrace(traceType, buffer) {
			assertOpen();
			if (!(buffer instanceof ArrayBuffer)) {
				throw new Error(
					'openTrace requires the exact ArrayBuffer to transfer; pass the underlying buffer, not a typed-array view'
				);
			}
			const opened = await send<OpenTraceResult>({ op: 'openTrace', traceType, buffer }, [buffer]);
			const state = new State('trace', owner, opened.traceId);
			states.add(state);
			return {
				id: opened.traceId,
				metadata: opened.metadata,
				hasRawFrames: opened.hasRawFrames,
				mf4Catalog: opened.mf4Catalog,
				embeddedDbcs: opened.embeddedDbcs,
				warnings: opened.warnings,
				// Object spread must copy this enumerable symbol and retain the shared state.
				[HandleState]: state
			} as unknown as TraceHandle;
		},
		async closeTrace(handle) {
			await closeHandle('trace', handle);
		},
		async getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName) {
			assertOpen();
			const dbc = liveState('dbc', dbcHandle);
			const trace = liveState('trace', traceHandle);
			return unpackSeries(
				await send<SeriesPayload>(
					{
						op: 'getSignalValues',
						dbcId: dbc.wireId,
						traceId: trace.wireId,
						messageIdentity,
						signalName
					},
					[]
				)
			);
		},
		async getMf4SignalValues(traceHandle, signalId) {
			assertOpen();
			const trace = liveState('trace', traceHandle);
			return unpackSeries(
				await send<SeriesPayload>({ op: 'getMf4SignalValues', traceId: trace.wireId, signalId }, [])
			);
		},
		close() {
			closePromise ??= (async () => {
				let cleanupError: unknown = null;
				if (!fatalError) {
					try {
						// Runs after every previously posted request via the worker's serial queue.
						await send<null>({ op: 'closeClient' }, []);
					} catch (error) {
						// A fatal crash mid-close still terminates cleanly below.
						if (error !== fatalError) cleanupError = error;
					}
				}
				invalidateHandles();
				worker.terminate();
				if (cleanupError) throw cleanupError;
			})();
			return closePromise;
		}
	};
}

function unpackSeries(payload: SeriesPayload): DecodedSignalSeries {
	return {
		timesMs: new Float64Array(payload.buffer, payload.timesByteOffset, payload.timesLength),
		values: new Float64Array(payload.buffer, payload.valuesByteOffset, payload.valuesLength)
	};
}

function fromWireError(error: WireError): Error {
	const rebuilt = new Error(error.message);
	rebuilt.name = error.name;
	return rebuilt;
}
