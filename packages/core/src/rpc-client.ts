import { createHandleRegistry } from './handles.ts';
import { snapshotLimits, dbcBytes, assertByteLimit, type ParsingLimits } from './limits.ts';
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
	RawSource,
	DecodedSignalSeries,
	OpenDbcResult,
	OpenTraceResult,
	TraceHandle,
	TraceType
} from './types.ts';

/**
 * Dedicated-worker client; requests run serially in call order.
 * Startup failure or a worker crash/exit rejects pending and future operations and invalidates
 * all handles. Create a new client to recover.
 */
export type CanTraceClient = {
	openDbc(input: Uint8Array | string): Promise<OpenDbcResult>;
	/** Idempotent for this client's handles. */
	closeDbc(handle: DbcHandle): Promise<void>;
	/**
	 * After input preflight, transfers and detaches `buffer`, even if parsing fails.
	 * Pass the exact file ArrayBuffer; typed-array views are rejected.
	 */
	openTrace(traceType: TraceType, buffer: ArrayBuffer): Promise<OpenTraceResult>;
	/** Idempotent for this client's handles. */
	closeTrace(handle: TraceHandle): Promise<void>;
	/** Both returned arrays are views over one ArrayBuffer transferred out of the worker. */
	getSignalValues(
		dbcHandle: DbcHandle,
		traceHandle: TraceHandle,
		messageIdentity: DbcMessageIdentity,
		signalName: string,
		source?: RawSource
	): Promise<DecodedSignalSeries>;
	getMf4SignalValues(traceHandle: TraceHandle, signalId: number): Promise<DecodedSignalSeries>;
	/**
	 * Idempotent. Waits for queued work and cleanup, invalidates handles, and terminates the worker.
	 */
	close(): Promise<void>;
};

export type RpcTransportHandlers = {
	message(data: WorkerResponse): void;
	fail(error: Error): void;
};

export type RpcTransport = {
	postMessage(message: WorkerRequest, transfer: ArrayBuffer[]): void;
	terminate(): Promise<void>;
};

export type RpcTransportFactory = (handlers: RpcTransportHandlers) => RpcTransport;

export async function createRpcClient(
	createTransport: RpcTransportFactory,
	inputLimits?: ParsingLimits
): Promise<CanTraceClient> {
	const limits = snapshotLimits(inputLimits);
	const handles = createHandleRegistry<{ dbc: number; trace: number }>();
	const pending = new Map<
		number,
		{ resolve: (value: WorkerOkResult) => void; reject: (error: Error) => void }
	>();
	let nextRequestId = 1;
	let fatalError: Error | null = null;
	let closePromise: Promise<void> | null = null;
	let termination: Promise<void> | null = null;
	let transport: RpcTransport | null = null;

	let ready!: { resolve: () => void; reject: (error: Error) => void };
	const readyPromise = new Promise<void>((resolve, reject) => {
		ready = { resolve, reject };
	});

	function receive(response: WorkerResponse): void {
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
	}

	function fail(error: Error): void {
		if (fatalError) return;
		fatalError = error;
		handles.releaseAll();
		const entries = [...pending.values()];
		pending.clear();
		for (const entry of entries) entry.reject(error);
		void terminate().catch(() => undefined);
		ready.reject(error);
	}

	function terminate(): Promise<void> {
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
	else {
		try {
			transport.postMessage({ op: 'init', id: 0, limits }, []);
		} catch (error) {
			fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	function assertOpen(): void {
		if (fatalError) throw fatalError;
		if (closePromise) throw new Error('client is closed');
	}

	async function sendClose(body: WorkerRequestBody): Promise<void> {
		if (fatalError || closePromise) return;
		await send<null>(body, []);
	}

	await readyPromise;

	return {
		async openDbc(input) {
			assertOpen();
			const bytes = dbcBytes(input, limits.maxDbcBytes);
			const payload =
				bytes.buffer instanceof ArrayBuffer &&
				bytes.byteOffset === 0 &&
				bytes.byteLength === bytes.buffer.byteLength
					? bytes
					: Uint8Array.from(bytes);
			const { dbcId, catalog, warnings } = await send<WireOpenDbc>(
				{ op: 'openDbc', input: payload },
				[]
			);
			return { handle: handles.issue('dbc', dbcId), catalog, warnings };
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
			assertByteLimit(buffer.byteLength, limits.maxTraceInputBytes, 'Trace input');
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
		async getSignalValues(dbcHandle, traceHandle, messageIdentity, signalName, source) {
			assertOpen();
			const dbcId = handles.payload('dbc', dbcHandle);
			const traceId = handles.payload('trace', traceHandle);
			return unpackSeries(
				await send<SeriesPayload>(
					{ op: 'getSignalValues', dbcId, traceId, messageIdentity, signalName, source },
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
						await send<null>({ op: 'closeClient' }, []);
					} catch (error) {
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

function fromWireError(error: WireError): Error {
	const rebuilt = new Error(error.message);
	rebuilt.name = error.name;
	return rebuilt;
}
