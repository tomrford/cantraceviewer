# AGENTS.md

This repo is the source for CAN Trace Viewer, a client-side CAN log inspection app.

Live instance: https://cantraceviewer.com

Product shape: open directly into the plotter. Load one ASC, PCAN TRC 1.x/2.x, or BLF trace, save one or more DBC files to the local browser library, select signals from the sidebar, and render decoded signal series on a shared time plot.

Implementation shape: SvelteKit/Svelte 5 with Bun, Tailwind, and shadcn-svelte style components. Zig code lives under `wasm/` and compiles to WebAssembly for DBC parsing, trace parsing, and signal decode work.

Keep TypeScript as the glue between the Svelte UI and WASM workers. Keep WASM details behind typed browser-facing interfaces.

Saved DBC files and UI preferences live only in browser storage on the current device. Loaded traces and derived signal series live in memory for the current browser session. Do not add server persistence or new persisted state without an explicit product reason.

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

Backlog lives in the Linear `cantraceviewer` project.

### Zig

We are using Zig 0.16.0 for the WASM parts of the project. Docs can be found at https://ziglang.org/documentation/0.16.0/.
