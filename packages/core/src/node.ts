import { Worker } from 'node:worker_threads';
import { createNodeClientForWorker } from './node-transport.ts';
import type { CanTraceClient } from './rpc-client.ts';
import type { ParsingLimits } from './limits.ts';

export { DEFAULT_PARSING_LIMITS, type ParsingLimits } from './limits.ts';

export type { CanTraceClient } from './rpc-client.ts';
export type * from './types.ts';

/**
 * Creates a dedicated Node worker thread with the browser client's lifecycle and ordering.
 * Importing starts no worker. Use the package root for browser bundles.
 */
export async function createCanTraceClient(limits?: ParsingLimits): Promise<CanTraceClient> {
	return createNodeClientForWorker(
		() => new Worker(workerEntry(), { execArgv: workerExecArgv() }),
		limits
	);
}

function workerEntry(): URL {
	const entry = import.meta.url.endsWith('.ts') ? './node-worker.ts' : './node-worker.js';
	return new URL(entry, import.meta.url);
}

function workerExecArgv(): string[] {
	return process.execArgv.filter(
		(argument) => argument !== '--input-type' && !argument.startsWith('--input-type=')
	);
}
