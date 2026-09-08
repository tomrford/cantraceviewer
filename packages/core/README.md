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
const { handle: dbc, catalog } = await client.openDbc(new Uint8Array(await dbcFile.arrayBuffer()));
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
const { handle: dbc, catalog } = await client.openDbc(await readFile('network.dbc'));
const file = await readFile('drive.blf');
const buffer = Uint8Array.from(file).buffer;
const trace = await client.openTrace('blf', buffer);

// Decode as in the browser example, using dbc and trace.handle.

await client.closeTrace(trace.handle);
await client.closeDbc(dbc);
await client.close();
```

The copy in this example creates an exact `ArrayBuffer`. If a Node buffer already spans an ordinary `ArrayBuffer` exactly, that underlying buffer can be passed directly.

## Raw sources

`trace.metadata.rawMessages` lists the distinct raw data-frame identifiers and their
`source: { channel, direction }`. Channels retain the format's one-based number;
`null` means unavailable or unspecified. Direction is `rx`, `tx`, or `unknown`.
Numeric channels through 65535 are supported. Malformed text channel numbers are
reported as skipped lines; they are never merged into a valid channel.

Pass a source as the optional fifth argument to `getSignalValues` to decode only
that channel and direction. Omitting it selects the sole source for the requested
CAN identifier and standard/extended status. Multiple sources cause an error;
an absent identifier or explicitly selected absent source returns empty arrays.

```ts
const series = await client.getSignalValues(dbc, trace.handle, message, signal.name, {
	channel: 2,
	direction: 'rx'
});
```

Source identity is separate from DBC payload and frame-format matching. DLC and
per-occurrence CAN FD flags do not split sources. Opening a trace builds its raw
frame index to expose this catalogue; subsequent decoding reuses the index.

Raw and MF4-native decoded series are chronological. Equal timestamps retain
their order in the source, and trace duration uses the latest timestamp even
when records arrive out of order.

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

## DBC input and diagnostics

All three clients accept `openDbc(input: Uint8Array | string)`. Bytes are decoded in Rust: strip one initial UTF-8 BOM, accept valid UTF-8, otherwise decode the entire remaining input as Windows-1252. Undefined Windows-1252 bytes (81, 8D, 8F, 90 and 9D hex) become U+FFFD. Strings are UTF-8 encoded before using the same parser. Byte views, including Node Buffers and subviews, are copied, never transferred or detached.

`OpenDbcResult.warnings` is an array of plain `DbcDiagnostic` objects, independent of the handle lifetime. Each contains `category`, `keyword`, `line`, `column`, and `message`. Categories are `unsupported-record`, `dangling-reference`, and `omitted-feature`. Positions identify the start of the record keyword in decoded text: one-based lines and Unicode scalar columns, with tabs counting as one column and the initial BOM excluded. Warnings are ordered by source position and contain no raw source or record contents. Unknown keywords are reported as `unknown`.

Unsupported records (including comments and attributes the viewer does not use), unresolved value attachments, omitted Vector independent-signal containers, and signal definitions requiring transport reassembly produce warnings while retaining the usable catalogue. Namespace keyword declarations and the VERSION, BS*, and BU* headers do not warn. Semicolon records may span lines; quoted contents are never interpreted as definitions. Invalid supported records, unterminated semicolon records, duplicate message identities or signal names, ambiguous value attachments, named signal-type records that could change decoding, and invalid supported signal layouts reject the load. Errors include the record position and keyword; their text is for display, not application branching.

The catalogue includes simple and extended multiplexed signals. Decoding returns only frames matching the raw selector values, including nested selector ranges. Explicit frame formats distinguish classical CAN and CAN FD even when their payload lengths match.

J1939 messages expose PGN, source address and priority metadata; decoding still matches the exact CAN identifier and standard/extended status. PGN remapping and transport reassembly are unsupported. Messages exceeding 64 payload bytes, and J1939 messages exceeding 8 bytes, remain catalogue metadata with `rawFrameDecodable: false`. Their signals produce warnings. Callers should inspect warnings even when a catalogue contains no selectable signals.
