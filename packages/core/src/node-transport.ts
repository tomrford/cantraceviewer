import { isMarkedAsUntransferable } from 'node:worker_threads';
import {
	createRpcClient,
	type CanTraceClient,
	type RpcTransport,
	type RpcTransportHandlers
} from './rpc-client.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

/** @internal */
export type NodeClientWorker = {
	postMessage(message: WorkerRequest, transfer?: readonly ArrayBuffer[]): void;
	on(event: 'message', listener: (data: WorkerResponse) => void): void;
	on(event: 'messageerror', listener: (error: Error) => void): void;
	on(event: 'error', listener: (error: Error) => void): void;
	on(event: 'exit', listener: (code: number) => void): void;
	terminate(): Promise<number>;
};

/** @internal */
export async function createNodeClientForWorker(
	createWorker: () => NodeClientWorker
): Promise<CanTraceClient> {
	return createRpcClient((handlers) => nodeTransport(createWorker(), handlers));
}

function nodeTransport(worker: NodeClientWorker, handlers: RpcTransportHandlers): RpcTransport {
	let stopping = false;

	worker.on('message', (data) => handlers.message(data));
	worker.on('error', (error) => {
		handlers.fail(new Error(`worker thread crashed: ${error.message}`, { cause: error }));
	});
	worker.on('messageerror', (error) => {
		handlers.fail(new Error(`worker thread message failed to deserialize: ${error.message}`));
	});
	worker.on('exit', (code) => {
		// A requested terminate always ends in an exit event; only an unrequested one is a failure.
		if (stopping) return;
		handlers.fail(new Error(`worker thread exited unexpectedly with code ${code}`));
	});

	return {
		postMessage(message, transfer) {
			if (transfer.some(isMarkedAsUntransferable)) {
				throw new Error('openTrace cannot transfer an ArrayBuffer marked as untransferable');
			}
			worker.postMessage(message, transfer);
		},
		async terminate() {
			stopping = true;
			await worker.terminate();
		}
	};
}
