import { isMarkedAsUntransferable } from 'node:worker_threads';
import {
	createRpcClient,
	type CanTraceClient,
	type RpcTransport,
	type RpcTransportHandlers
} from './rpc-client.ts';

/** worker_threads surface used by the private Node transport and its tests. @internal */
export type NodeClientWorker = {
	postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
	on(event: 'message', listener: (data: unknown) => void): unknown;
	on(event: 'messageerror', listener: (error: Error) => void): unknown;
	on(event: 'error', listener: (error: Error) => void): unknown;
	on(event: 'exit', listener: (code: number) => void): unknown;
	terminate(): Promise<unknown>;
};

/** Private seam for deterministic transport tests. @internal */
export async function createNodeClientForWorker(
	createWorker: () => NodeClientWorker
): Promise<CanTraceClient> {
	return createRpcClient((handlers) => nodeTransport(createWorker(), handlers));
}

/** worker_threads EventEmitter events mapped onto the shared client core. */
function nodeTransport(worker: NodeClientWorker, handlers: RpcTransportHandlers): RpcTransport {
	let stopping = false;

	worker.on('message', (data) => handlers.message(data));
	worker.on('error', (error) => {
		handlers.fail(new Error(`worker thread crashed: ${describe(error)}`, { cause: error }));
	});
	worker.on('messageerror', (error) => {
		handlers.fail(new Error(`worker thread message failed to deserialize: ${describe(error)}`));
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

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
