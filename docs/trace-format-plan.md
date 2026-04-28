# Trace format plan

The trace parser layer normalizes trace inputs into one in-memory event stream before DBC decode. ASC is the v1 trace format. BLF is a v2 format once the ASC viewer path is working.

Format-specific parsers live in Zig/WASM. TypeScript owns file loading, worker orchestration, signal selection, plot viewport state, and plot rendering.

The viewer is intentionally narrow: it plots selected DBC signals over time. ASC parsing should extract only the fields needed to produce timestamp/value series. Everything else can stay as raw source text for later support.

The v1 product flow is:

- load one or more DBC files
- use DBC JSON to populate message and signal options
- load at most one ASC trace file
- parse the ASC into a WASM-owned trace handle
- select one signal at a time
- ask WASM to decode that selected signal across the trace
- cache and visualize the returned timestamp/value series in the frontend

## Normalized event model

Use a compact `TraceEvent` shape for payload-bearing trace frames:

- timestamp as relative nanoseconds from measurement start
- optional wall-clock measurement start metadata
- channel as the trace file reports it
- arbitration ID plus an explicit extended-ID flag
- frame kind: data, remote, error, or unknown
- raw DLC and resolved payload length
- payload bytes, up to 64 bytes

Keep timestamps and counters as integers in Zig. Across WASM, expose nanosecond timestamps as strings or split integers unless the value is known to fit safely in a JavaScript number. Do not store ASC event time as floating-point internally; parse decimal seconds text into integer nanoseconds.

For ASC, the header carries a wall-clock date and a timestamp mode. Event lines carry decimal seconds. `timestamps absolute` means event times are offsets from measurement start. `timestamps relative` means event times are deltas from the preceding event. Store the normalized cumulative offset as `timestamp_ns`.

## ASC reader

ASC is the first trace parser target. It is line-oriented, debuggable, and can cover the UI flow before BLF decompression and container handling exist. The initial code lives under `wasm/src/asc/`.

Supported first:

- header lines: `date`, `base <hex|dec> timestamps <absolute|relative>`, `internal events logged`, `no internal events logged`
- optional Vector version comments such as `// version 8.2.1`
- split-file comments such as `// 60.0000 previous log file: Inc_L1.asc`
- `Begin Triggerblock ...` and `End TriggerBlock`
- classic CAN data frames: `<Time> <Channel> <ID>[x] <Dir> d <DLC> <bytes...>`
- classic CAN remote frames: `<Time> <Channel> <ID>[x] <Dir> r [DLC]`
- classic CAN error frames as raw non-data events: `<Time> <Channel> ErrorFrame ...`
- CAN FD frames: `<Time> CANFD <Channel> <Dir> <ID> <SymbolicName> <BRS> <ESI> <DLC> <DataLength> ...`
- timestamped comment and global-marker lines as empty `unknown` events for relative timestamp accounting

Parser behavior:

- Parse one line at a time and preserve timestamped unrecognized lines as empty `unknown` events so relative timestamp accounting stays correct.
- Respect `base hex` and `base dec` for IDs and bytes.
- Treat `timestamps absolute` as offsets from measurement start, and `timestamps relative` as deltas from the preceding event.
- Keep the original channel numbering instead of normalizing to zero-based channels.
- Do not retain raw source lines after parsing.
- Do not parse direction, CAN FD timing, CRC, BRS, ESI, comments, markers, or export-only details unless a plot or signal decode path needs them.

The public ASC evidence is better than BLF but still not ideal. Vector publishes a current logging-format overview listing `.asc` as an ASCII frame logging file for CANoe/CANalyzer. A public mirror of Vector's `CAN_LOG_TRIGGER_ASC_Format.doc` describes the ASC grammar, including header lines, classic CAN, CAN FD, comments, and markers. `python-can` documents that no official open ASC specification is generally available through its docs and that its reader/writer is reverse-engineered from existing logs.

## DBC and signal decode

DBC parsing continues to use the existing handle-based WASM API. The UI can load more than one DBC file, keep one handle per parsed DBC, and use DBC JSON only as a display/index source for message and signal pickers.

Signal extraction is request-driven. The frontend does not ask WASM for every decoded signal up front. When the user selects a signal, WASM filters matching trace frames by CAN ID and extended-ID flag, decodes that signal in batch, and returns the full timestamp/value series for that signal.

The first signal-series API can be whole-series only:

- `trace_decode_signal(trace_handle, dbc_handle, message_id, is_extended, signal_name_ptr, signal_name_len) -> OwnedBytes`

The returned JSON is an array of timestamp/value points plus enough metadata for display:

- `timestampNs`
- `value`
- optional `rawValue`
- optional value-description label

Do not add `time_start` and `time_end` arguments to the first signal decode API. Range-specific decode makes zooming chatty across the WASM boundary and mixes plot viewport state into parsing/decoding. If selected-signal series are too large, add a separate plot-oriented API that takes a time range and pixel width and returns min/max or representative buckets:

- `trace_decode_signal_lod(trace_handle, dbc_handle, signal, start_ns, end_ns, pixel_width)`

The frontend owns lazy display. It caches decoded signal series and downsamples already-decoded points for plot rendering. WASM owns parsing, frame indexing, DBC signal decode, and later optional level-of-detail generation.

## Development slices

Build the ASC path in the same style as the current DBC path:

1. Add a Zig ASC parser with small unit tests and hand-written fixture strings.
2. Add a WASM handle API that parses ASC and exports trace JSON.
3. Add a small UI proof that loads one ASC file and renders parsed frame counts.
4. Add DBC/ASC interop by decoding one selected signal through WASM.
5. Add frontend caching and plot rendering around the selected signal series.

This sequence keeps the parser and UI independently testable before signal decode joins them.

## BLF reader

BLF is the second trace parser target. The implementation follows the existing BLF research notes in `docs/blf-file-format.md` and keeps the first slice CAN/CAN-FD-only.

Supported first:

- `LOGG` file header with raw header bytes preserved
- outer `LOBJ` iteration with length checks
- `LOG_CONTAINER` objects with compression method `0` and `2`
- zlib-inflated inner object stream
- cross-container tail buffering for objects split across container boundaries
- object headers version 1 and 2
- `CAN_MESSAGE`, `CAN_MESSAGE2`, `CAN_ERROR_EXT`, `CAN_FD_MESSAGE`, and `CAN_FD_MESSAGE_64`
- metadata objects only where useful for display: `APP_TEXT`, `GLOBAL_MARKER`, `REALTIME_CLOCK`
- unknown object skip with raw object preservation

Parser behavior:

- Fail strict mode on bad magic, impossible sizes, unsupported compression, and integer overflow.
- Keep best-effort recovery separate from the initial strict parser.
- Preserve raw object bytes for unknown and partially supported objects.
- Do not copy GPL implementation logic from `vector_blf`, Wireshark, BUSMASTER, or GPL `cantools` code.

## WASM boundary

The ASC browser-facing API should mirror the current DBC pattern but return trace JSON:

- `trace_parse_asc(ptr, len) -> handle`
- `trace_to_json(handle) -> OwnedBytes`
- `trace_free(handle)`
- `trace_decode_signal(...) -> OwnedBytes`

That full-file API is enough for the first UI slice. Keep the Zig parser internally stream-shaped so a worker-backed chunk API can be added without rewriting ASC line handling or later BLF container handling:

- `trace_parser_new(format) -> handle`
- `trace_parser_push(handle, ptr, len)`
- `trace_parser_finish(handle)`
- `trace_parser_take_json(handle) -> OwnedBytes`

## Fixtures and verification

Use small hand-written ASC fixtures first:

- classic standard ID data frame
- classic extended ID data frame
- remote frame
- error frame
- CAN FD frame with payload length above 8 bytes
- relative timestamp header
- decimal base header
- comments and markers

Use BLF fixtures only when licensing is clear. Prefer self-generated files or fixtures with explicit redistribution terms. If Vector tooling is available, use it as a differential oracle without shipping the generated corpus until licensing is reviewed.

Run before handoff:

```sh
nix develop -c bun run test
nix develop -c bunx svelte-check --tsconfig ./tsconfig.json
cd wasm && nix develop -c zig build test
```
