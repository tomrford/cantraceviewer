# AGENTS.md

This repo is a client-side CAN trace viewer. The UI is SvelteKit/Svelte 5 with Bun, Tailwind, and shadcn-svelte style components. Zig code lives under `wasm/` and compiles to WebAssembly for DBC parsing, trace parsing, and signal decode work.

Current product direction: open directly into the plotter. Load one ASC or PCAN TRC 1.x/2.x trace, load one or more DBC files, select signals from the sidebar, and render decoded signal series as relative-millisecond/value arrays on a shared time plot. BLF support is deferred until text trace signal plotting is solid.

Keep TypeScript as the glue between the Svelte UI and WASM workers. Do not make the UI depend on raw WASM pointers or allocator details; expose small typed adapters.

Do not add persistence by default. Loaded files and derived state live in memory for the current browser session.

Enforce browser file-size caps in TypeScript before reading file contents: DBC files are capped at 1 MiB per file, and trace files are capped at 500 MiB per file.

Use repo-native commands via `nix develop`:

```sh
bun run dev
bun run test
bun run check
bun run wasm:build:release
bun run wasm:test
```

The repo commits the release WASM binary for git-based deployment on Cloudflare Workers. If you change Zig code, run `bun run wasm:build:release` before committing so the bundle is updated.

Open work:

- Add a WASM benchmark harness that builds `Debug`, `ReleaseSafe`, `ReleaseFast`, and `ReleaseSmall`, records raw/gzip sizes, and separately times instantiate, DBC parse/JSON export, trace parse, and signal-series extraction against fixed fixtures. Only needed if we start running into noticeable perf issues with the small build.
- Investigate ChartGPU point-marker support for selected signal traces. The plot uses line series only until ChartGPU can render per-sample markers cleanly during close zoom levels without custom canvas overlays.
- Render selected signals with a single decoded sample as one point instead of hiding them from the plot state.
- If selected-signal graphing spends meaningful time rescanning traces, consider a batch decode API or per-message frame index so multiple selected signals can share one pass over matching trace frames.
- Use the Rust `blf_asc` crate and Python `python-can` behavior as references when implementing BLF parsing.
- Add a social preview image if share cards need richer previews.
- better error handling across the WASM surface (so we get meaningful failures back).

### Zig

We are using Zig 0.16.0 for the WASM parts of the project. Docs can be found at https://ziglang.org/documentation/0.16.0/.
