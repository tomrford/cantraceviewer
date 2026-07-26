import { createDirectClient } from './direct.ts';
import { startWorkerRuntime, type WorkerRuntimeEndpoint } from './worker-runtime.ts';

// Dedicated module Worker entry: one per client, created lazily by createCanTraceClient(). It
// loads the package-local generated WASM binary and owns the direct client for its lifetime.
startWorkerRuntime(self as unknown as WorkerRuntimeEndpoint, async () => {
	const response = await fetch(new URL('./wasm-bindgen/cantraceviewer_bg.wasm', import.meta.url));
	if (!response.ok) {
		throw new Error(`failed to fetch WASM module: HTTP ${response.status}`);
	}
	return createDirectClient(await WebAssembly.compile(await response.arrayBuffer()));
});
