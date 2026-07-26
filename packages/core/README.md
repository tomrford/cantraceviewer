# cantraceviewer

`cantraceviewer` parses DBC files and CAN traces, then decodes selected signal series. It supports ASC, PCAN TRC 1.x/2.x, BLF, and MF4 traces.

The package has three ESM entries:

- `cantraceviewer` — asynchronous browser client using one dedicated Web Worker
- `cantraceviewer/direct` — synchronous in-process WebAssembly client
- `cantraceviewer/node` — asynchronous Node.js client using one dedicated worker thread

The browser and Node clients are transports over the same direct implementation. The package has no server component and does not persist input data.

## Browser

Create the client in browser code, not during server-side rendering. `openTrace` transfers and detaches the exact input `ArrayBuffer`.

```ts
import { createCanTraceClient } from 'cantraceviewer';

const client = await createCanTraceClient();
const { handle: dbc, catalog } = await client.openDbc(await dbcFile.text());
const trace = await client.openTrace('asc', await traceFile.arrayBuffer());

const message = catalog.messages[0];
const signal = message.signals[0];
const series = await client.getSignalValues(
	dbc,
	trace.handle,
	{
		canId: message.canId,
		isExtended: message.isExtended,
		sizeBytes: message.sizeBytes
	},
	signal.name
);

await client.closeTrace(trace.handle);
await client.closeDbc(dbc);
await client.close();
```

`openTrace` also returns metadata, parse warnings, embedded DBC files, and the native MF4 signal catalog where applicable.

## Direct

The direct client is fully synchronous. The caller must read, fetch, or asynchronously compile the WASM before creating it. The exported `wasmUrl` identifies the package-local binary.

```ts
import { readFile } from 'node:fs/promises';
import { createDirectClient, wasmUrl } from 'cantraceviewer/direct';

const wasm = await readFile(wasmUrl);
const client = createDirectClient(wasm);
const { handle: dbc, catalog } = client.openDbc(dbcText);
const trace = client.openTrace('blf', traceBytes);
const message = catalog.messages[0];
const series = client.getSignalValues(
	dbc,
	trace.handle,
	{
		canId: message.canId,
		isExtended: message.isExtended,
		sizeBytes: message.sizeBytes
	},
	message.signals[0].name
);

client.closeTrace(trace.handle);
client.closeDbc(dbc);
client.close();
```

`createDirectClient` also accepts a precompiled `WebAssembly.Module`. WebAssembly initializes once per JavaScript realm; later direct clients reuse that runtime while retaining separate handle ownership. Closing handles releases their Rust allocations, but WebAssembly memory pages are not guaranteed to return to the operating system until the realm or process ends.

Direct parsing and decoding block the calling thread. Do not use this entry on a browser UI thread or Electron main thread. It is intended for an existing Worker, worker thread, isolated process, benchmark, or controlled test.

## Node.js

The Node entry has the same asynchronous API as the browser entry. It owns the direct client and all handles inside one `worker_threads` worker.

```ts
import { readFile } from 'node:fs/promises';
import { createCanTraceClient } from 'cantraceviewer/node';

const client = await createCanTraceClient();
const { handle: dbc, catalog } = await client.openDbc(await readFile('network.dbc', 'utf8'));
const file = await readFile('drive.blf');
const buffer = Uint8Array.from(file).buffer;
const trace = await client.openTrace('blf', buffer);

// Decode as in the browser example, using dbc and trace.handle.

await client.closeTrace(trace.handle);
await client.closeDbc(dbc);
await client.close();
```

The copy in this example creates an exact `ArrayBuffer`. If a Node buffer already spans an ordinary `ArrayBuffer` exactly, that underlying buffer can be passed directly.

## Electron

Two arrangements are supported:

1. Use `cantraceviewer` in the renderer. Parsing and decoding run in its browser Web Worker. Serve the renderer over HTTP(S) or a standard, secure custom protocol so its ESM Worker and WASM assets can load; a bare `file://` renderer is not supported.
2. Use `cantraceviewer/node` in the main process and expose application-specific operations to the renderer through a context-isolated preload and Electron IPC. Parsing and decoding run in the package's worker thread.

Do not import `cantraceviewer/direct` in the renderer or main process because it blocks that thread.

## Handles and lifecycle

DBC and trace handles are opaque and belong to the client that created them. A handle cannot be used with another client. Closing a handle is idempotent. Closing a client invalidates all of its remaining handles.

Each asynchronous client processes requests in call order. A worker startup failure, crash, message failure, or unexpected Node worker exit is fatal for that client. Pending and future operations reject, all handles become invalid, and the package does not restart the worker automatically. Create a new client to recover.

Errors are standard `Error` objects. Their names and messages are diagnostics, not stable values for application branching.

## Transfer semantics

The browser and Node clients require the exact ordinary `ArrayBuffer` containing a trace. The buffer is transferred to the worker and detached immediately, including when parsing later fails. Typed-array views are rejected rather than copied implicitly. Node buffers marked as untransferable are rejected before posting and remain attached.

Decoded `timesMs` and `values` are two `Float64Array` views over one exactly sized `ArrayBuffer` transferred from the worker. Transferring that shared buffer elsewhere detaches both views.

The direct client accepts a `Uint8Array` and does not detach it.

## Supported environments

- Node.js 22.12 or newer for `cantraceviewer/node`
- Browsers and Electron renderers with ESM, module Workers, WebAssembly, and transferable `ArrayBuffer` support for `cantraceviewer`
- ESM-aware bundlers that preserve the standard `new Worker(new URL(..., import.meta.url))` asset pattern

The package does not support CommonJS, server persistence, browser environments without module Workers, synchronous browser UI-thread use, or synchronous Electron main-thread use.
