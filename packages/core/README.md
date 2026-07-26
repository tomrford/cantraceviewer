# cantraceviewer

`cantraceviewer` parses DBC files and CAN traces, then decodes selected signal series. It supports ASC, PCAN TRC 1.x/2.x, BLF, and MF4 traces.

The package has three ESM entries:

- `cantraceviewer` — asynchronous browser client
- `cantraceviewer/direct` — synchronous in-process WebAssembly client
- `cantraceviewer/node` — asynchronous Node.js client

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

`createDirectClient` also accepts a precompiled `WebAssembly.Module`.

Direct parsing and decoding block the calling thread. Use this entry only in an execution context where blocking is acceptable.

## Node.js

The Node entry has the same asynchronous API as the browser entry.

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

## Handles and lifecycle

DBC and trace handles are opaque and belong to the client that created them. A handle cannot be used with another client. Closing a handle is idempotent. Closing a client invalidates all of its remaining handles.

Worker failure is fatal for that client. Pending and future operations reject, all handles become invalid, and callers must create a new client to recover.

Errors are standard `Error` objects. Their names and messages are diagnostics, not stable values for application branching.

## Transfer semantics

The browser and Node clients require the exact ordinary `ArrayBuffer` containing a trace. The buffer is transferred to the worker and detached immediately, including when parsing later fails. Typed-array views are rejected rather than copied implicitly. Node buffers marked as untransferable are rejected before posting and remain attached.

Decoded `timesMs` and `values` are two `Float64Array` views over one exactly sized `ArrayBuffer` transferred from the worker. Transferring that shared buffer elsewhere detaches both views.

The direct client accepts a `Uint8Array` and does not detach it.

## Supported environments

- Node.js 22.12 or newer for `cantraceviewer/node`
- Browsers with ESM, module Workers, WebAssembly, and transferable `ArrayBuffer` support for `cantraceviewer`
- ESM-aware bundlers that preserve the standard `new Worker(new URL(..., import.meta.url))` asset pattern

The package does not support CommonJS or browsers without module Workers.
