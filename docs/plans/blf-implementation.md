# BLF Implementation Plan

Implement BLF as a third trace parser that feeds the existing retained trace model and selected-signal plot path. The browser-facing API should match ASC and TRC: TypeScript copies the uploaded file into WASM memory, calls `blf_parse`, receives an opaque trace handle, reads metadata through `trace_to_metadata_json`, and decodes signals through `get_trace_signal_values`.

Keep BLF parser internals separate from ASC and TRC. BLF is a binary container format with file headers, object headers, per-container compression, and inner object streams; it should share only the final `trace.Trace` storage boundary.

## Reference Points

- `docs/blf-file-format.md` is the local format reference.
- `grepo/python-can/can/io/blf.py` is the behavior reference for common CAN/CAN FD object parsing, zlib containers, timestamp conversion, tail handling, and `CAN_FD_MESSAGE_64` padding behavior.
- `grepo/blf_asc/src/lib.rs` is the compact Rust reference for the same object set and a useful shape for a small parser.
- Linear `LIN-40` tracks the feature: supported BLF files load under the existing trace file-size cap, BLF frames feed the same signal-series path, malformed or unsupported input fails across the WASM/TypeScript boundary, and representative fixtures cover parser and adapter behavior.

## Current Boundaries

- Trace files remain capped at 500 MiB in TypeScript before bytes are read.
- Inflation happens inside WASM.
- Zig 0.16 stdlib provides zlib inflation through `std.compress.flate.Decompress` with container `.zlib`; no Zig package dependency is needed.
- Detailed parse-error messages can stay on the later `last_error` export path. The first BLF pass may follow the current ASC/TRC zero-handle failure contract.
- The UI should not gain BLF-specific state. Add `.blf` detection and `TraceType = 'asc' | 'trc' | 'blf'`, then rely on the existing trace handle and plotting flow.

## First Parser Slice

Implement `wasm/src/blf/` with enough structure to parse classic CAN from real BLF containers:

- `LOGG` file header validation and header-size skipping.
- Measurement start parsing from the file-header `SYSTEMTIME` tuple.
- File-level `LOBJ` iteration with unknown non-container objects skipped by declared object size.
- `LOG_CONTAINER` handling for compression methods `0 = none` and `2 = zlib`.
- Container decompression with the declared uncompressed size used as the allocation and output limit.
- Inner `LOBJ` parsing with object-header versions 1 and 2.
- Tail buffering for logical objects split across container boundaries.
- Classic `CAN_MESSAGE` and `CAN_MESSAGE2` conversion into `trace.Frame`.
- Unknown inner object types skipped by declared object size.

This slice should export `blf_parse`, add `Handle.parseBlf`, wire the TypeScript trace-type switch, and accept `.blf` in the file input.

## Follow-Up Slice

Add CAN FD and error object support after classic BLF parsing and adapter flow work:

- `CAN_ERROR_EXT`.
- `CAN_FD_MESSAGE`.
- `CAN_FD_MESSAGE_64`, including `valid_bytes`, `ext_data_offset`, zero padding when valid bytes exceed available data, and the distinct direction/flag layout used by python-can.
- Timestamp resolution tests for both `TIME_TEN_MICS = 0x00000001` and `TIME_ONE_NANS = 0x00000002`.

Keep raw DLC and stored payload length distinct. `trace.Frame.dlc` carries the logged DLC-style value used by downstream decode/display decisions, while `payload_len` controls the stored bytes.

## Tests And Fixtures

Add fixtures under `wasm/test/fixtures` or a BLF-specific fixture subdirectory. Use tiny generated files where possible, and compare key behavior against `grepo/python-can` or `grepo/blf_asc` during fixture creation.

Representative coverage:

- Uncompressed container with one classic CAN frame.
- Zlib-compressed container with one classic CAN frame.
- Multiple containers.
- One logical inner object split across containers.
- Metadata or unknown file-level object before the first `LOG_CONTAINER`.
- Header v1 and v2 timestamps.
- Unsupported compression method.
- Truncated file/header/container/object cases.
- CAN FD and error-frame fixtures when the follow-up slice lands.

Run the normal gates for Zig and browser integration after implementation:

```sh
nix develop -c bun run wasm:test
nix develop -c bun run wasm:build:release
nix develop -c bun run test
nix develop -c bun run check
```

Because the release WASM binary is committed for deployment, every Zig parser change that affects browser behavior must refresh `src/lib/assets/cantraceviewer.wasm`.
