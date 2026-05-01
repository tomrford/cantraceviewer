# CAN Trace Viewer

Client-side CAN trace viewer for plotting DBC-decoded signal values from ASC logs. The app uses SvelteKit for the browser UI and Zig compiled to WebAssembly for DBC parsing, ASC parsing, and signal decode work.

The browser opens directly into the plotter. Load one ASC trace, load one or more DBC files, filter/select signals from the sidebar, and inspect decoded values on a shared time plot.

The WASM boundary exposes opaque DBC and ASC handles, JSON exports for DBC catalogs and ASC metadata, and a selected-signal sample export as little-endian `(timestamp_ns, value_f64)` records. TypeScript owns browser file handling and copies parsed data into normal UI state; the UI does not depend on raw WASM pointers.

Data stays in the current browser session. Refreshing the page clears loaded files and derived state.

Browser file inputs enforce per-file size caps before reading contents: DBC files are capped at 1 MiB, and ASC trace files are capped at 500 MiB.

## Development

```sh
nix develop -c bun install
nix develop -c bun run dev
nix develop -c bun run wasm:build
```

Useful checks:

```sh
nix develop -c bun run test
nix develop -c bunx svelte-check --tsconfig ./tsconfig.json
nix develop -c sh -c 'cd wasm && zig build test'
```
