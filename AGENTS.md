# AGENTS.md

This repo is a client-side CAN trace viewer. The UI is SvelteKit/Svelte 5 with Bun, Tailwind, and shadcn-svelte style components. Zig code lives under `wasm/` and compiles to WebAssembly for DBC parsing, ASC parsing, and signal decode work.

Current product direction: open directly into the plotter. Load one ASC trace, load one or more DBC files, select signals from the sidebar, and render decoded `(timestamp_ns, value_f64)` samples on a shared time plot. BLF/TRC support is deferred until ASC signal plotting is solid.

Keep TypeScript as the glue between the Svelte UI and WASM workers. Do not make the UI depend on raw WASM pointers or allocator details; expose small typed adapters.

Do not add persistence by default. Loaded files and derived state live in memory for the current browser session.

Enforce browser file-size caps in TypeScript before reading file contents: DBC files are capped at 1 MiB per file, and ASC trace files are capped at 100 MiB per file.

Use repo-native commands via `nix develop`:

```sh
bun run dev
bun run test
bunx svelte-check --tsconfig ./tsconfig.json
cd wasm && zig build test
```

`bun run check` runs SvelteKit sync and `svelte-check` against `tsconfig.json`.

Open work:

- Add a WASM benchmark harness that builds `Debug`, `ReleaseSafe`, `ReleaseFast`, and `ReleaseSmall`, records raw/gzip sizes, and separately times instantiate, DBC parse/JSON export, ASC parse, and signal-series extraction against fixed fixtures.
- Investigate ChartGPU point-marker support for selected signal traces. The plot uses line series only until ChartGPU can render per-sample markers cleanly during close zoom levels without custom canvas overlays.
- Render selected signals with a single decoded sample as one point instead of hiding them from the plot state.
- If selected-signal graphing spends meaningful time rescanning traces, consider a batch decode API or per-message frame index so multiple selected signals can share one pass over matching ASC frames.
- If parsed ASC frame memory becomes a measured problem, consider compact frame storage with `Asc` owning `frames: []Frame` plus a contiguous `payloads: []u8` side buffer; data frames store payload offset/length, while remote/error/unknown events store no payload bytes.

### Zig

We are using Zig 0.16.0 for the WASM parts of the project. Docs can be found at https://ziglang.org/documentation/0.16.0/.
