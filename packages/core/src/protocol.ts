import type {
	DbcHandle,
	DbcMessageIdentity,
	DecodedSignalSeries,
	OpenDbcResult,
	OpenTraceResult,
	RawSource,
	TraceHandle,
	TraceType
} from './types.ts';

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
	/** Returned arrays share one exactly-sized ArrayBuffer. */
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

type Async<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never;
};

/**
 * Dedicated-worker client with the direct client's methods; requests run serially in call order.
 * Decoded arrays are views over one ArrayBuffer transferred out of the worker. `close` waits for
 * queued work and cleanup, invalidates handles, and terminates the worker.
 * Startup failure or a worker crash/exit rejects pending and future operations and invalidates
 * all handles. Create a new client to recover.
 */
export type CanTraceClient = Omit<Async<DirectClient>, 'openTrace'> & {
	/**
	 * After input preflight, transfers and detaches `buffer`, even if parsing fails.
	 * Pass the exact file ArrayBuffer; typed-array views are rejected.
	 */
	openTrace(traceType: TraceType, buffer: ArrayBuffer): Promise<OpenTraceResult>;
};

export type Method = keyof DirectClient;

/**
 * Handle arguments always come first; they travel as worker-issued ids in `handles`, and a
 * result's `handle` travels as its id.
 */
export type WorkerRequest = {
	id: number;
	method: Method | 'init';
	handles: number[];
	args: unknown[];
};

export type WireError = { name: string; message: string };

export type WorkerResponse =
	| { type: 'ready' }
	| { type: 'boot-error'; error: WireError }
	| { type: 'ok'; id: number; result: unknown }
	| { type: 'error'; id: number; error: WireError };
