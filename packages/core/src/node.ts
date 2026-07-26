import { Worker } from 'node:worker_threads';
import { createNodeClientForWorker } from './node-transport.ts';
import type { CanTraceClient } from './rpc-client.ts';

export type { CanTraceClient } from './rpc-client.ts';
export type * from './types.ts';

/**
 * Create a client backed by one new dedicated worker thread. Same interface, lifecycle, and
 * ordering guarantees as the browser client; the worker reads the packaged WASM binary from disk
 * instead of fetching it.
 *
 * Nothing is instantiated at module import time. Import this entry only from Node; the package root
 * stays free of Node built-ins for browser bundles.
 */
export async function createCanTraceClient(): Promise<CanTraceClient> {
	return createNodeClientForWorker(() => new Worker(workerEntry(), { execArgv: workerExecArgv() }));
}

/**
 * The packaged build ships compiled JavaScript siblings. A source checkout runs this file as
 * TypeScript, where Node's type stripping loads the TypeScript worker entry directly.
 */
function workerEntry(): URL {
	const entry = import.meta.url.endsWith('.ts') ? './node-worker.ts' : './node-worker.js';
	return new URL(entry, import.meta.url);
}

/** Flags such as `--input-type` are valid only for eval/stdin and break a file-backed Worker. */
function workerExecArgv(): string[] {
	return process.execArgv.filter(
		(argument) => argument !== '--input-type' && !argument.startsWith('--input-type=')
	);
}
