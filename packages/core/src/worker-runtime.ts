import type { DirectClient } from './direct.js';
import type { SeriesPayload, WireError, WorkerRequest, WorkerResponse } from './protocol.js';
import type { DbcHandle, DecodedSignalSeries, TraceHandle } from './types.js';

export type WorkerRuntimeEndpoint = {
	postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
	addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
};

type Executed = {
	result: unknown;
	transfer?: Transferable[];
	/** Reverses resource creation when the success response cannot be posted. */
	undo?: () => Promise<void>;
};

/**
 * Drive one DirectClient behind a message endpoint. The worker owns every direct handle because
 * wasm-bindgen objects carry hidden state that cannot cross threads; only plain data crosses the
 * wire. Requests run strictly serially in post order through an explicit queue, so a later close
 * never interrupts an active decode. A per-request error is replied as an error envelope and
 * never poisons the queue. Boot failure is reported once and never retried here; the owning
 * client treats it as fatal and terminates this worker.
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

	// Explicit serial queue: each request starts only after the previous one fully settled.
	let queue: Promise<void> = boot;
	endpoint.addEventListener('message', (event) => {
		const request = event.data as WorkerRequest;
		queue = queue.then(() => handle(request)).catch(() => undefined);
	});

	async function handle(request: WorkerRequest): Promise<void> {
		let executed: Executed;
		try {
			if (!direct) throw new Error('worker WASM initialization failed');
			executed = await execute(direct, request);
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
			if (executed.undo) await executed.undo().catch(() => undefined);
			endpoint.postMessage({ type: 'error', id: request.id, error: toWireError(error) });
		}
	}

	async function execute(client: DirectClient, request: WorkerRequest): Promise<Executed> {
		switch (request.op) {
			case 'openDbc': {
				const { handle, catalog } = await client.openDbc(request.text);
				const dbcId = nextWireId++;
				dbcs.set(dbcId, handle);
				return {
					result: { dbcId, catalog },
					undo: async () => {
						dbcs.delete(dbcId);
						await client.closeDbc(handle);
					}
				};
			}
			case 'closeDbc': {
				const handle = dbcs.get(request.dbcId);
				if (handle) {
					dbcs.delete(request.dbcId);
					await client.closeDbc(handle);
				}
				return { result: null };
			}
			case 'openTrace': {
				const handle = await client.openTrace(request.traceType, new Uint8Array(request.buffer));
				const traceId = nextWireId++;
				traces.set(traceId, handle);
				return {
					result: {
						traceId,
						metadata: handle.metadata,
						hasRawFrames: handle.hasRawFrames,
						mf4Catalog: handle.mf4Catalog,
						embeddedDbcs: handle.embeddedDbcs,
						warnings: handle.warnings
					},
					undo: async () => {
						traces.delete(traceId);
						await client.closeTrace(handle);
					}
				};
			}
			case 'closeTrace': {
				const handle = traces.get(request.traceId);
				if (handle) {
					traces.delete(request.traceId);
					await client.closeTrace(handle);
				}
				return { result: null };
			}
			case 'getSignalValues': {
				const series = await client.getSignalValues(
					requireHandle(dbcs, request.dbcId, 'dbc'),
					requireHandle(traces, request.traceId, 'trace'),
					request.messageIdentity,
					request.signalName
				);
				return packSeries(series);
			}
			case 'getMf4SignalValues': {
				const series = await client.getMf4SignalValues(
					requireHandle(traces, request.traceId, 'trace'),
					request.signalId
				);
				return packSeries(series);
			}
			case 'closeClient': {
				dbcs.clear();
				traces.clear();
				await client.close();
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
