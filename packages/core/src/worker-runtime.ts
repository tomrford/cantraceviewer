import type { ParsingLimits } from './limits.ts';
import type { DirectClient, WireError, WorkerRequest, WorkerResponse } from './protocol.ts';
import type { DbcHandle, TraceHandle } from './types.ts';

export type WorkerRuntimeEndpoint = {
	postMessage(message: WorkerResponse, transfer?: ArrayBuffer[]): void;
	addEventListener(type: 'message', listener: (event: { data: WorkerRequest }) => void): void;
};

export function startWorkerRuntime(
	endpoint: WorkerRuntimeEndpoint,
	loadClient: (limits: ParsingLimits) => Promise<DirectClient>
): void {
	const handles = new Map<number, DbcHandle | TraceHandle>();
	let direct: DirectClient | null = null;
	let nextHandleId = 1;

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
		if (event.data.method === 'init' && initialize) {
			initialize(event.data.args[0] as ParsingLimits);
			initialize = null;
			return;
		}
		queue = queue.then(() => handle(event.data)).catch(() => undefined);
	});

	function handle({ id, method, handles: handleIds, args }: WorkerRequest): void {
		let result: unknown;
		let undo: (() => void) | undefined;
		try {
			if (!direct) throw new Error('worker WASM initialization failed');
			const client = direct;
			if (method === 'init' || !Object.hasOwn(client, method)) {
				throw new Error(`unknown worker method ${method}`);
			}
			const inputs = handleIds.map((handleId) => {
				const found = handles.get(handleId);
				if (!found) throw new Error(`unknown handle id ${handleId}`);
				return found;
			});
			if (method === 'close') handles.clear();
			if (method.startsWith('close')) handleIds.forEach((handleId) => handles.delete(handleId));
			result = (client[method] as (...params: unknown[]) => unknown).apply(client, [
				...inputs,
				...args
			]);
			if (result && typeof result === 'object' && 'handle' in result) {
				const opened = result.handle as DbcHandle & TraceHandle;
				const handleId = nextHandleId++;
				handles.set(handleId, opened);
				undo = () => {
					handles.delete(handleId);
					client[method === 'openDbc' ? 'closeDbc' : 'closeTrace'](opened);
				};
				result = { ...result, handle: handleId };
			}
		} catch (error) {
			endpoint.postMessage({ type: 'error', id, error: toWireError(error) });
			return;
		}
		try {
			endpoint.postMessage({ type: 'ok', id, result }, [...transferables(result)]);
		} catch (error) {
			try {
				undo?.();
			} catch {} // eslint-disable-line no-empty
			endpoint.postMessage({ type: 'error', id, error: toWireError(error) });
		}
	}
}

/** Every typed array in a result owns its buffer, so results move out of the worker uncopied. */
function transferables(value: unknown, found = new Set<ArrayBuffer>()): Set<ArrayBuffer> {
	if (ArrayBuffer.isView(value)) found.add(value.buffer as ArrayBuffer);
	else if (value && typeof value === 'object') {
		for (const nested of Object.values(value)) transferables(nested, found);
	}
	return found;
}

function toWireError(cause: unknown): WireError {
	if (cause instanceof Error) return { name: cause.name, message: cause.message };
	return { name: 'Error', message: String(cause) };
}
