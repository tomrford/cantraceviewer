import { readFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';
// Relative imports carry `.ts` extensions throughout this package because Node loads this worker
// entry from source through type stripping, which resolves specifiers literally. `tsc` rewrites
// them to `.js` when it emits the packaged build.
import { createDirectClient } from './direct.ts';
import { startWorkerRuntime, type WorkerRuntimeEndpoint } from './worker-runtime.ts';
import type { WorkerResponse } from './protocol.ts';

// Dedicated worker-thread entry: one per Node client, created by createCanTraceClient(). It reads
// the packaged WASM binary from disk, compiles it, and owns the direct client for its lifetime.
const port = parentPort;
if (!port) {
	throw new Error('the cantraceviewer worker entry must run inside a worker thread');
}

const endpoint: WorkerRuntimeEndpoint = {
	postMessage(message: WorkerResponse, transfer = []) {
		// Transfer lists are ArrayBuffers only, which worker_threads transfers like postMessage.
		port.postMessage(message, transfer as ArrayBuffer[]);
	},
	addEventListener(_type, listener) {
		port.on('message', (data: unknown) => listener({ data }));
	}
};

startWorkerRuntime(endpoint, async () => {
	const bytes = await readFile(new URL('./wasm-bindgen/cantraceviewer_bg.wasm', import.meta.url));
	// Compiling here keeps the only asynchronous step outside the synchronous direct client.
	return createDirectClient(await WebAssembly.compile(bytes));
});
