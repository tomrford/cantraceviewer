import type { DirectClient } from './direct.ts';
import type {
	SeriesPayload,
	WireError,
	WireOpenDbc,
	WireOpenTrace,
	WorkerOkResult,
	WorkerRequest,
	WorkerResponse
} from './protocol.ts';
import type { DbcHandle, DecodedSignalSeries, TraceHandle } from './types.ts';

/**
 * Message endpoint a worker host provides: `self` in a browser Worker, the parent port in a Node
 * worker thread. @internal
 */
export type WorkerRuntimeEndpoint = {
	postMessage(message: WorkerResponse, transfer?: ArrayBuffer[]): void;
	addEventListener(type: 'message', listener: (event: { data: WorkerRequest }) => void): void;
};

type Executed = {
	result: WorkerOkResult;
	transfer?: ArrayBuffer[];
	/** Reverses resource creation when the success response cannot be posted. */
	undo?: () => void;
};

/**
 * Drive one synchronous DirectClient behind a message endpoint. Shared by the browser Worker entry
 * and the Node worker-thread entry. @internal
 *
 * The worker owns every direct handle because wasm-bindgen objects carry hidden state that cannot
 * cross threads; only plain data crosses the wire. Each request runs to completion before the next
 * one starts, in post order, so a later close never interrupts an active decode. A per-request
 * error is replied as an error envelope and never poisons the queue. Boot failure is reported once
 * and never retried here; the owning client treats it as fatal and terminates this worker.
 */
export function startWorkerRuntime(
	endpoint: WorkerRuntimeEndpoint,
	loadClient: () => Promise<DirectClient>
): void {
	const dbcs = new Map<number, DbcHandle>();
	const traces = new Map<number, TraceHandle>();
	let direct: DirectClient | null = null;
	// Wire IDs are never recycled.
	let nextWireId = 1;

	// Loading WASM is the only asynchronous step: bytes arrive over fetch or from disk, and may be
	// compiled, before the synchronous direct client exists.
	const boot = loadClient()
		.then(
			(loaded) => {
				direct = loaded;
				endpoint.postMessage({ type: 'ready' });
			},
			(error) => {
				endpoint.postMessage({ type: 'boot-error', error: toWireError(error) });
			}
		)
		.catch(() => undefined);

	// Requests posted before boot finishes wait behind it; afterwards each one is handled
	// synchronously in the order the endpoint delivered it.
	let queue: Promise<void> = boot;
	endpoint.addEventListener('message', (event) => {
		queue = queue.then(() => handle(event.data)).catch(() => undefined);
	});

	function handle(request: WorkerRequest): void {
		let executed: Executed;
		try {
			if (!direct) throw new Error('worker WASM initialization failed');
			executed = execute(direct, request);
		} catch (error) {
			endpoint.postMessage({ type: 'error', id: request.id, error: toWireError(error) });
			return;
		}
		try {
			endpoint.postMessage(
				{ type: 'ok', id: request.id, result: executed.result },
				executed.transfer ?? []
			);
		} catch (error) {
			// Response shaping failed after the operation succeeded: release what it created.
			try {
				executed.undo?.();
			} catch {
				// Cleanup failure must not replace the reported response error.
			}
			endpoint.postMessage({ type: 'error', id: request.id, error: toWireError(error) });
		}
	}

	function execute(client: DirectClient, request: WorkerRequest): Executed {
		switch (request.op) {
			case 'openDbc': {
				const { handle, catalog } = client.openDbc(request.text);
				const dbcId = nextWireId++;
				dbcs.set(dbcId, handle);
				const result: WireOpenDbc = { dbcId, catalog };
				return {
					result,
					undo: () => {
						dbcs.delete(dbcId);
						client.closeDbc(handle);
					}
				};
			}
			case 'closeDbc': {
				const handle = dbcs.get(request.dbcId);
				if (handle) {
					dbcs.delete(request.dbcId);
					client.closeDbc(handle);
				}
				return { result: null };
			}
			case 'openTrace': {
				const opened = client.openTrace(request.traceType, new Uint8Array(request.buffer));
				const traceId = nextWireId++;
				traces.set(traceId, opened.handle);
				const result: WireOpenTrace = {
					traceId,
					metadata: opened.metadata,
					hasRawFrames: opened.hasRawFrames,
					mf4Catalog: opened.mf4Catalog,
					embeddedDbcs: opened.embeddedDbcs,
					warnings: opened.warnings
				};
				return {
					result,
					undo: () => {
						traces.delete(traceId);
						client.closeTrace(opened.handle);
					}
				};
			}
			case 'closeTrace': {
				const handle = traces.get(request.traceId);
				if (handle) {
					traces.delete(request.traceId);
					client.closeTrace(handle);
				}
				return { result: null };
			}
			case 'getSignalValues':
				return packSeries(
					client.getSignalValues(
						requireHandle(dbcs, request.dbcId, 'dbc'),
						requireHandle(traces, request.traceId, 'trace'),
						request.messageIdentity,
						request.signalName
					)
				);
			case 'getMf4SignalValues':
				return packSeries(
					client.getMf4SignalValues(
						requireHandle(traces, request.traceId, 'trace'),
						request.signalId
					)
				);
			case 'closeClient': {
				dbcs.clear();
				traces.clear();
				client.close();
				return { result: null };
			}
		}
	}
}

function requireHandle<T>(handles: Map<number, T>, id: number, kind: string): T {
	const handle = handles.get(id);
	if (!handle) throw new Error(`unknown ${kind} id ${id}`);
	return handle;
}

function packSeries(series: DecodedSignalSeries): Executed {
	const buffer = series.timesMs.buffer;
	// Regression guard: direct decode output must be both views over one exactly-sized plain
	// ArrayBuffer, not into WebAssembly.Memory (whose buffer is far larger and non-transferable).
	if (
		!(buffer instanceof ArrayBuffer) ||
		series.values.buffer !== buffer ||
		buffer.byteLength !== series.timesMs.byteLength + series.values.byteLength
	) {
		throw new Error('decoded series is not backed by one transferable ArrayBuffer');
	}
	const result: SeriesPayload = {
		buffer,
		timesByteOffset: series.timesMs.byteOffset,
		timesLength: series.timesMs.length,
		valuesByteOffset: series.values.byteOffset,
		valuesLength: series.values.length
	};
	// Transfer the unique buffer once; the client reconstructs both views over it.
	return { result, transfer: [buffer] };
}

function toWireError(error: unknown): WireError {
	if (error instanceof Error) return { name: error.name, message: error.message };
	return { name: 'Error', message: String(error) };
}
