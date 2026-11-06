import { createHandleRegistry } from './handles.ts';
import { snapshotLimits, dbcBytes, assertByteLimit, type ParsingLimits } from './limits.ts';
import type {
	CanTraceClient,
	DirectClient,
	Method,
	WireError,
	WorkerRequest,
	WorkerResponse
} from './protocol.ts';
import type { DbcHandle, TraceHandle } from './types.ts';

export type RpcTransportHandlers = {
	message(data: WorkerResponse): void;
	fail(error: Error): void;
};

export type RpcTransport = {
	postMessage(message: WorkerRequest, transfer: ArrayBuffer[]): void;
	terminate(): Promise<void>;
};

export type RpcTransportFactory = (handlers: RpcTransportHandlers) => RpcTransport;

/** Arguments after the leading handles, which travel separately as ids. */
type ArgsAfterHandles<P> = P extends [DbcHandle | TraceHandle, ...infer Rest]
	? ArgsAfterHandles<Rest>
	: P;
/** A worker result, with any opened handle replaced by its id. */
type WireResult<R> = R extends { handle: unknown } ? Omit<R, 'handle'> & { handle: number } : R;

export async function createRpcClient(
	createTransport: RpcTransportFactory,
	inputLimits?: ParsingLimits
): Promise<CanTraceClient> {
	const limits = snapshotLimits(inputLimits);
	const handles = createHandleRegistry<{ dbc: number; trace: number }>();
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
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

	function call<M extends Method>(
		method: M,
		handleIds: number[],
		args: ArgsAfterHandles<Parameters<DirectClient[M]>>,
		transfer: ArrayBuffer[] = []
	): Promise<WireResult<ReturnType<DirectClient[M]>>> {
		const active = transport;
		if (fatalError || !active) {
			return Promise.reject(fatalError ?? new Error('client transport is unavailable'));
		}
		const id = nextRequestId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			try {
				active.postMessage({ id, method, handles: handleIds, args }, transfer);
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
			transport.postMessage({ id: 0, method: 'init', handles: [], args: [limits] }, []);
		} catch (error) {
			fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	function assertOpen(): void {
		if (fatalError) throw fatalError;
		if (closePromise) throw new Error('client is closed');
	}

	await readyPromise;

	return {
		async openDbc(input) {
			assertOpen();
			const bytes = dbcBytes(input, limits.maxDbcBytes);
			const exact =
				bytes.buffer instanceof ArrayBuffer &&
				bytes.byteOffset === 0 &&
				bytes.byteLength === bytes.buffer.byteLength
					? bytes
					: Uint8Array.from(bytes);
			const opened = await call('openDbc', [], [exact]);
			return { ...opened, handle: handles.issue('dbc', opened.handle) };
		},
		async closeDbc(handle) {
			const handleId = handles.release('dbc', handle);
			if (handleId !== null && !fatalError && !closePromise) await call('closeDbc', [handleId], []);
		},
		async openTrace(traceType, buffer) {
			assertOpen();
			if (!(buffer instanceof ArrayBuffer)) {
				throw new Error(
					'openTrace requires the exact ArrayBuffer to transfer; pass the underlying buffer, not a typed-array view'
				);
			}
			assertByteLimit(buffer.byteLength, limits.maxTraceInputBytes, 'Trace input');
			const opened = await call('openTrace', [], [traceType, new Uint8Array(buffer)], [buffer]);
			return { ...opened, handle: handles.issue('trace', opened.handle) };
		},
		async closeTrace(handle) {
			const handleId = handles.release('trace', handle);
			if (handleId !== null && !fatalError && !closePromise)
				await call('closeTrace', [handleId], []);
		},
		async getSignalValues(dbcHandle, traceHandle, ...args) {
			assertOpen();
			const ids = [handles.payload('dbc', dbcHandle), handles.payload('trace', traceHandle)];
			return call('getSignalValues', ids, args);
		},
		async getMf4SignalValues(traceHandle, signalId) {
			assertOpen();
			return call('getMf4SignalValues', [handles.payload('trace', traceHandle)], [signalId]);
		},
		close() {
			closePromise ??= (async () => {
				let cleanupError: Error | null = null;
				if (!fatalError) {
					try {
						await call('close', [], []);
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

function fromWireError(error: WireError): Error {
	const rebuilt = new Error(error.message);
	rebuilt.name = error.name;
	return rebuilt;
}
