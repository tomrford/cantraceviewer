import {
	createRpcClient,
	type CanTraceClient,
	type RpcTransport,
	type RpcTransportHandlers
} from './rpc-client.ts';

export type { CanTraceClient } from './rpc-client.ts';

/** @internal */
export type ClientWorkerEvent = { data?: unknown; message?: string };

/** @internal */
export type ClientWorker = {
	postMessage(message: unknown, transfer: Transferable[]): void;
	addEventListener(
		type: 'message' | 'error' | 'messageerror',
		listener: (event: ClientWorkerEvent) => void
	): void;
	terminate(): void;
};

/**
 * Create a client backed by a new dedicated module Worker. Call in the browser only; nothing is
 * instantiated at module import time, so importing this package is SSR/prerender safe. This module
 * never touches Node built-ins, so it stays bundleable for the browser.
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
	return createRpcClient((handlers) => browserTransport(createWorker(), handlers));
}

function browserTransport(worker: ClientWorker, handlers: RpcTransportHandlers): RpcTransport {
	worker.addEventListener('message', (event) => handlers.message(event.data));
	worker.addEventListener('error', (event) => {
		handlers.fail(new Error(`worker crashed${event.message ? `: ${event.message}` : ''}`));
	});
	worker.addEventListener('messageerror', () => {
		handlers.fail(new Error('worker message failed to deserialize'));
	});
	return {
		postMessage(message, transfer) {
			worker.postMessage(message, transfer);
		},
		async terminate() {
			worker.terminate();
		}
	};
}
