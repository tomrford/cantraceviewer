import { readFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';
// Relative imports carry `.ts` extensions throughout this package because Node loads this worker
// entry from source through type stripping, which resolves specifiers literally. `tsc` rewrites
// them to `.js` when it emits the packaged build.
import { createDirectClient } from './direct.ts';
import { startWorkerRuntime, type WorkerRuntimeEndpoint } from './worker-runtime.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const port = parentPort;
if (!port) {
	throw new Error('the cantraceviewer worker entry must run inside a worker thread');
}

const endpoint: WorkerRuntimeEndpoint = {
	postMessage(message: WorkerResponse, transfer = []) {
		port.postMessage(message, transfer as ArrayBuffer[]);
	},
	addEventListener(_type, listener) {
		port.on('message', (data) => listener({ data: data as WorkerRequest }));
	}
};

startWorkerRuntime(endpoint, async () => {
	const bytes = await readFile(new URL('./wasm-bindgen/cantraceviewer_bg.wasm', import.meta.url));
	return createDirectClient(await WebAssembly.compile(bytes));
});
