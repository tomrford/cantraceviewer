import { createDirectClient } from './direct.ts';
import { startWorkerRuntime, type WorkerRuntimeEndpoint } from './worker-runtime.ts';

startWorkerRuntime(self as unknown as WorkerRuntimeEndpoint, async () => {
	const response = await fetch(new URL('./wasm-bindgen/cantraceviewer_bg.wasm', import.meta.url));
	if (!response.ok) {
		throw new Error(`failed to fetch WASM module: HTTP ${response.status}`);
	}
	return createDirectClient(await WebAssembly.compile(await response.arrayBuffer()));
});
