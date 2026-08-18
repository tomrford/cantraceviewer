import { createHandleRegistry } from './handles.ts';
import type {
	SeriesPayload,
	WireError,
	WireOpenDbc,
	WireOpenTrace,
	WorkerOkResult,
	WorkerRequest,
	WorkerRequestBody,
	WorkerResponse
} from './protocol.ts';
import type {
	DbcHandle,
	DbcMessageIdentity,
	DecodedSignalSeries,
	OpenDbcResult,
	OpenTraceResult,
	TraceHandle,
	TraceType
} from './types.ts';

/**
 * Asynchronous CAN trace client backed by one dedicated worker. The browser entry and the Node
 * entry expose exactly this interface over their own transport.
 *
 * Every method is genuine worker RPC; the worker runs requests strictly serially in call order.
 * Worker startup failure, a crash, or an unexpected exit is fatal for the client: every pending and
 * future operation rejects, every handle is invalidated, and the worker is terminated without
 * restart. Create a new client to recover.
 */
export type CanTraceClient = {
	openDbc(text: string): Promise<OpenDbcResult>;
	/** Idempotent for handles this client issued; repeat calls resolve without effect. */
	closeDbc(handle: DbcHandle): Promise<void>;
	/**
	 * Parse one trace. `buffer` must be the exact ArrayBuffer holding the file bytes: it is
	 * transferred to the worker and detached in the caller, and it stays consumed even when
	 * parsing fails. Typed-array views are rejected rather than silently copied.
	 */
	openTrace(traceType: TraceType, buffer: ArrayBuffer): Promise<OpenTraceResult>;
	/** Idempotent for handles this client issued; repeat calls resolve without effect. */
	closeTrace(handle: TraceHandle): Promise<void>;
	/** Both returned arrays are views over one ArrayBuffer transferred out of the worker. */
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

/** Events a transport reports to the shared client core. @internal */
export type RpcTransportHandlers = {
	/** One structured-clone payload received from the worker. */
	message(data: WorkerResponse): void;
	/** Unrecoverable transport failure: crash, exit, or undeliverable message. */
	fail(error: Error): void;
};

/** Worker transport the shared client core drives. @internal */
export type RpcTransport = {
	postMessage(message: WorkerRequest, transfer: ArrayBuffer[]): void;
	/** Stop the worker. Resolves once it is gone; called at most once. */
	terminate(): Promise<void>;
};

/** @internal */
export type RpcTransportFactory = (handlers: RpcTransportHandlers) => RpcTransport;

/**
 * Shared asynchronous client core: request ids, the pending-request table, handle ownership,
 * fatal-failure handling, and close semantics. It knows nothing about Web Workers or worker
 * threads; a transport supplies those. @internal
 */
export async function createRpcClient(
	createTransport: RpcTransportFactory
): Promise<CanTraceClient> {
	const handles = createHandleRegistry<{ dbc: number; trace: number }>();
	const pending = new Map<
		number,
		{ resolve: (value: WorkerOkResult) => void; reject: (error: Error) => void }
	>();
	// Request IDs are never recycled.
	let nextRequestId = 1;
	let fatalError: Error | null = null;
	let closePromise: Promise<void> | null = null;
	let termination: Promise<void> | null = null;
	// Assigned below, once the handlers it reports to exist.
	let transport: RpcTransport | null = null;

	let resolveReady!: () => void;
	let rejectReady!: (error: Error) => void;
	const readyPromise = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});

	function receive(response: WorkerResponse): void {
		if (response.type === 'ready') {
			resolveReady();
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
	}

	/** Worker failure is terminal for this client: nothing ever restarts the worker. */
	function fail(error: Error): void {
		if (fatalError) return;
		fatalError = error;
		handles.releaseAll();
		const entries = [...pending.values()];
		pending.clear();
		for (const entry of entries) entry.reject(error);
		void terminate().catch(() => undefined);
		rejectReady(error);
	}

	function terminate(): Promise<void> {
		// A transport that reports failure while it is still being created has nothing to stop yet.
		if (!transport) return Promise.resolve();
		termination ??= transport.terminate();
		return termination;
	}

	function send<T extends WorkerOkResult>(
		body: WorkerRequestBody,
		transfer: ArrayBuffer[]
	): Promise<T> {
		const active = transport;
		if (fatalError || !active) {
			return Promise.reject(fatalError ?? new Error('client transport is unavailable'));
		}
		const id = nextRequestId++;
		return new Promise<T>((resolve, reject) => {
			pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject
			});
			try {
				active.postMessage({ ...body, id }, transfer);
			} catch (error) {
				pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	transport = createTransport({ message: receive, fail });
	if (fatalError) void terminate().catch(() => undefined);

	function assertOpen(): void {
		if (fatalError) throw fatalError;
		if (closePromise) throw new Error('client is closed');
	}

	/**
	 * After a fatal failure or client close, worker-side cleanup already happened or the whole
	 * direct client is being torn down; only the local handle mark is needed.
	 */
	async function sendClose(body: WorkerRequestBody): Promise<void> {
		if (fatalError || closePromise) return;
		await send<null>(body, []);
	}

	await readyPromise;

	return {
		async openDbc(text) {
			assertOpen();
			const { dbcId, catalog } = await send<WireOpenDbc>({ op: 'openDbc', text }, []);
			return { handle: handles.issue('dbc', dbcId), catalog };
		},
		async closeDbc(handle) {
			const dbcId = handles.release('dbc', handle);
			if (dbcId === null) return;
			await sendClose({ op: 'closeDbc', dbcId });
		},
		async openTrace(traceType, buffer) {
			assertOpen();
			if (!(buffer instanceof ArrayBuffer)) {
				throw new Error(
					'openTrace requires the exact ArrayBuffer to transfer; pass the underlying buffer, not a typed-array view'
				);
			}
			const opened = await send<WireOpenTrace>({ op: 'openTrace', traceType, buffer }, [buffer]);
			return {
				handle: handles.issue('trace', opened.traceId),
				metadata: opened.metadata,
				hasRawFrames: opened.hasRawFrames,
				mf4Catalog: opened.mf4Catalog,
				embeddedDbcs: opened.embeddedDbcs,
				warnings: opened.warnings
			};
		},
		async closeTrace(handle) {
			const traceId = handles.release('trace', handle);
			if (traceId === null) return;
			await sendClose({ op: 'closeTrace', traceId });
		},
		async getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName) {
			assertOpen();
			const dbcId = handles.payload('dbc', dbcHandle);
			const traceId = handles.payload('trace', traceHandle);
			return unpackSeries(
				await send<SeriesPayload>(
					{ op: 'getSignalValues', dbcId, traceId, messageIdentity, signalName },
					[]
				)
			);
		},
		async getMf4SignalValues(traceHandle, signalId) {
			assertOpen();
			const traceId = handles.payload('trace', traceHandle);
			return unpackSeries(
				await send<SeriesPayload>({ op: 'getMf4SignalValues', traceId, signalId }, [])
			);
		},
		close() {
			closePromise ??= (async () => {
				let cleanupError: Error | null = null;
				if (!fatalError) {
					try {
						// Runs after every previously posted request via the worker's serial queue.
						await send<null>({ op: 'closeClient' }, []);
					} catch (error) {
						// A fatal crash mid-close still terminates cleanly below.
						if (error !== fatalError) {
							cleanupError = error instanceof Error ? error : new Error(String(error));
						}
					}
				}
				handles.releaseAll();
				await terminate();
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

/**
 * Errors keep their diagnostic name and message across the wire. Neither is a stable contract:
 * treat them as diagnostics, not as values to branch on.
 */
function fromWireError(error: WireError): Error {
	const rebuilt = new Error(error.message);
	rebuilt.name = error.name;
	return rebuilt;
}
