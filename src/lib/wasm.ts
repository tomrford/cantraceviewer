import WasmWorker from './wasm.worker.ts?worker';
import {
	ParsedDbcSchema,
	TraceMetadataSchema,
	type DbcMessageIdentity,
	type DecodedSignalSeries,
	type ParsedDbc,
	type TraceMetadata,
	type TraceType,
	type WasmRpcPayload,
	type WasmWorkerMessage
} from './wasm-rpc.types.js';

export type {
	DbcMessage,
	DbcMessageIdentity,
	DbcSignal,
	DbcValueDescription,
	DecodedSignalSeries,
	ParsedDbc,
	TraceMetadata,
	TraceType
} from './wasm-rpc.types.js';

export type DbcHandle = {
	readonly id: string;
};

export type TraceHandle = {
	readonly id: string;
	readonly metadata: TraceMetadata;
};

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

let worker: Worker | null = null;
let bootPromise: Promise<void> | null = null;
let bootReady = false;
let resolveBoot: (() => void) | null = null;
let rejectBoot: ((error: Error) => void) | null = null;
const pendingRequests = new Map<string, PendingRequest>();

function ensureWorker(): Worker {
	if (worker) {
		return worker;
	}

	bootPromise ??= new Promise<void>((resolve, reject) => {
		resolveBoot = resolve;
		rejectBoot = reject;
	});

	worker = new WasmWorker();
	worker.addEventListener('message', handleWorkerMessage);
	worker.addEventListener('error', handleWorkerError);
	worker.addEventListener('messageerror', handleWorkerMessageError);
	worker.postMessage({ type: 'sync' });

	return worker;
}

function handleWorkerMessage(event: MessageEvent<WasmWorkerMessage>): void {
	const message = event.data;

	if ('type' in message) {
		switch (message.type) {
			case 'ready':
				resolveBootOnce();
				return;
			case 'boot-failed':
				failWorker(new Error(message.error));
				return;
			case 'sync':
				return;
		}
	}

	if (!('id' in message)) {
		return;
	}

	const pending = pendingRequests.get(message.id);
	if (!pending) {
		return;
	}

	pendingRequests.delete(message.id);

	if (message.ok) {
		pending.resolve(message.result);
		return;
	}

	pending.reject(new Error(message.error));
}

function handleWorkerError(event: ErrorEvent): void {
	failWorker(new Error(event.message || 'WASM worker failed'));
}

function handleWorkerMessageError(): void {
	failWorker(new Error('WASM worker message failed'));
}

function resolveBootOnce(): void {
	if (bootReady) {
		return;
	}

	bootReady = true;
	resolveBoot?.();
	resolveBoot = null;
	rejectBoot = null;
}

function rejectAllPending(error: Error): void {
	for (const pending of pendingRequests.values()) {
		pending.reject(error);
	}
	pendingRequests.clear();
}

function resetWorkerState(): void {
	worker = null;
	bootPromise = null;
	bootReady = false;
	resolveBoot = null;
	rejectBoot = null;
}

function failWorker(error: Error): void {
	rejectBoot?.(error);
	rejectAllPending(error);
	worker?.terminate();
	resetWorkerState();
}

async function bootWorker(): Promise<void> {
	if (bootReady) {
		return;
	}

	await ensureWorker();
	await bootPromise;
}

async function rpc<T>(request: WasmRpcPayload, transfer: Transferable[] = []): Promise<T> {
	await bootWorker();

	const id = crypto.randomUUID();

	return new Promise<T>((resolve, reject) => {
		pendingRequests.set(id, {
			resolve: (value) => resolve(value as T),
			reject
		});

		ensureWorker().postMessage({ ...request, id }, transfer);
	});
}

export async function openDbc(text: string): Promise<DbcHandle> {
	const result = await rpc<{ handleId: string }>({ op: 'openDbc', text });
	return { id: result.handleId };
}

export async function getDbcCatalog(handle: DbcHandle): Promise<ParsedDbc> {
	const result = await rpc<{ json: string }>({ op: 'getDbcCatalog', handleId: handle.id });
	return ParsedDbcSchema.parse(JSON.parse(result.json));
}

export async function closeDbc(handle: DbcHandle): Promise<void> {
	await rpc<null>({ op: 'closeDbc', handleId: handle.id });
}

export async function getSignalValues(
	dbcHandle: DbcHandle,
	trace: TraceHandle,
	messageIdentity: DbcMessageIdentity,
	signalName: string
): Promise<DecodedSignalSeries> {
	const result = await rpc<{ timesMs: Float64Array; values: Float64Array }>({
		op: 'getSignalValues',
		dbcHandleId: dbcHandle.id,
		traceHandleId: trace.id,
		messageIdentity,
		signalName
	});

	return {
		timesMs: result.timesMs,
		values: result.values
	};
}

export async function getTraceMetadata(handle: Pick<TraceHandle, 'id'>): Promise<TraceMetadata> {
	const result = await rpc<{ json: string }>({ op: 'getTraceMetadata', handleId: handle.id });
	return TraceMetadataSchema.parse(JSON.parse(result.json));
}

export async function closeTrace(trace: TraceHandle): Promise<void> {
	await rpc<null>({ op: 'closeTrace', handleId: trace.id });
}

export async function openTrace(traceType: TraceType, bytes: Uint8Array): Promise<TraceHandle> {
	const result = await rpc<{ handleId: string; metadataJson: string }>(
		{ op: 'openTrace', traceType, bytes },
		[bytes.buffer]
	);

	return {
		id: result.handleId,
		metadata: TraceMetadataSchema.parse(JSON.parse(result.metadataJson))
	};
}
