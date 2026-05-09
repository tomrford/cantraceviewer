# CAN Trace Viewer

Client-side CAN trace viewer for plotting DBC-decoded signal values from ASC and PCAN TRC 1.x/2.x logs. The app uses SvelteKit for the browser UI and Zig compiled to WebAssembly for DBC parsing, trace parsing, and signal decode work.

The browser opens directly into the plotter. Load one ASC or PCAN TRC 1.x/2.x trace, load one or more DBC files, filter/select signals from the sidebar, and inspect decoded values on a shared time plot.

The WASM boundary exposes opaque DBC and trace-format handles, JSON exports for DBC catalogs and trace metadata, and selected-signal sample exports as parallel `f64` arrays for relative milliseconds and decoded values. TypeScript owns browser file handling and copies parsed data into normal UI state; the UI does not depend on raw WASM pointers.

Data stays in the current browser session. Refreshing the page clears loaded files and derived state.

Browser file inputs enforce per-file size caps before reading contents: DBC files are capped at 1 MiB, and trace files are capped at 500 MiB.

## Development

```sh
nix develop -c bun install
nix develop -c bun run dev
nix develop -c bun run wasm:build
```

Useful checks:

```sh
nix develop -c bun run test
nix develop -c bun run check
nix develop -c bun run wasm:test
nix develop -c bun run wasm:build:release
```
