import {
	createRpcClient,
	type CanTraceClient,
	type RpcTransport,
	type RpcTransportHandlers
} from './rpc-client.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import type { ParsingLimits } from './limits.ts';

export type { CanTraceClient } from './rpc-client.ts';

export type ClientWorkerEvent = { data?: WorkerResponse; message?: string };

export type ClientWorker = {
	postMessage(message: WorkerRequest, transfer: Transferable[]): void;
	addEventListener(
		type: 'message' | 'error' | 'messageerror',
		listener: (event: ClientWorkerEvent) => void
	): void;
	terminate(): void;
};

/**
 * Creates a dedicated browser Worker. Call in the browser; importing is SSR-safe.
 */
export async function createCanTraceClient(limits?: ParsingLimits): Promise<CanTraceClient> {
	if (typeof Worker === 'undefined') {
		throw new Error('createCanTraceClient requires Web Worker support; call it in the browser');
	}
	return createCanTraceClientForWorker(
		() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
		limits
	);
}

export async function createCanTraceClientForWorker(
	createWorker: () => ClientWorker,
	limits?: ParsingLimits
): Promise<CanTraceClient> {
	return createRpcClient((handlers) => browserTransport(createWorker(), handlers), limits);
}

function browserTransport(worker: ClientWorker, handlers: RpcTransportHandlers): RpcTransport {
	worker.addEventListener('message', (event) => handlers.message(event.data as WorkerResponse));
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
