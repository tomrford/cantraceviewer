import type { DirectClient } from './direct.ts';
import type { ParsingLimits } from './limits.ts';
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

export type WorkerRuntimeEndpoint = {
	postMessage(message: WorkerResponse, transfer?: ArrayBuffer[]): void;
	addEventListener(type: 'message', listener: (event: { data: WorkerRequest }) => void): void;
};

type Executed = {
	result: WorkerOkResult;
	transfer?: ArrayBuffer[];
	undo?: () => void;
};

export function startWorkerRuntime(
	endpoint: WorkerRuntimeEndpoint,
	loadClient: (limits: ParsingLimits) => Promise<DirectClient>
): void {
	const dbcs = new Map<number, DbcHandle>();
	const traces = new Map<number, TraceHandle>();
	let direct: DirectClient | null = null;
	let nextWireId = 1;

	let initialize: ((limits: ParsingLimits) => void) | null = null;
	const boot = new Promise<ParsingLimits>((resolve) => {
		initialize = resolve;
	})
		.then((limits) => loadClient(limits))
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

	let queue: Promise<void> = boot;
	endpoint.addEventListener('message', (event) => {
		if (event.data.op === 'init' && initialize) {
			initialize(event.data.limits);
			initialize = null;
			return;
		}
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
			try {
				executed.undo?.();
			} catch {}
			endpoint.postMessage({ type: 'error', id: request.id, error: toWireError(error) });
		}
	}

	function execute(client: DirectClient, request: WorkerRequest): Executed {
		switch (request.op) {
			case 'init':
				throw new Error('worker is already initialized');
			case 'openDbc': {
				const { handle, catalog, warnings } = client.openDbc(request.input);
				const dbcId = nextWireId++;
				dbcs.set(dbcId, handle);
				const result: WireOpenDbc = { dbcId, catalog, warnings };
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
					transfer: opened.embeddedDbcs.map((dbc) => dbc.bytes.buffer as ArrayBuffer),
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
						request.signalName,
						request.source
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
	return { result, transfer: [buffer] };
}

function toWireError(cause: unknown): WireError {
	if (cause instanceof Error) return { name: cause.name, message: cause.message };
	return { name: 'Error', message: String(cause) };
}
