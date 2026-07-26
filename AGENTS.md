# AGENTS.md

This repo is the source for CAN Trace Viewer, a client-side CAN log plotter.

The live instance is at https://cantraceviewer.com, served entirely statically from Cloudflare workers.

The app opens directly into the plotter. Users load one CAN trace, save one or more DBC files to the local browser library, select signals from the signal selector popover, and render decoded signal series on a shared time plot.

Signals share one x axis and start on one y axis. The legend manages up to five y axes: signals move between them by drag and drop or by the move menu on each row. The app owns the y axis gutters and tick labels in DOM, because ChartGPU anchors every left axis at the same edge and does not render the y axis line. Y navigation is uniform: one gesture moves every axis by the same proportion of its own fit range, so each axis keeps fitting its own signals.

The UI uses SvelteKit, Svelte 5, Node.js, pnpm, Tailwind, and shadcn-svelte style components. Rust code lives under `wasm/` and compiles through wasm-bindgen for DBC parsing, trace parsing, and signal decoding. The app consumes an exact registry version of the `cantraceviewer` package. Its browser root and `/node` entries are asynchronous worker transports over the synchronous `/direct` implementation; the app uses the browser client and owns one dedicated Worker.

Saved DBC files and UI preferences live only in browser storage on the current device. Loaded traces, MF4-native signal catalogs, temporary embedded DBCs, and derived signal series live in memory for the current browser session. Do not add server persistence or new persisted state without an explicit product reason.

Enforce browser file-size caps in TypeScript before reading file contents: DBC files are capped at 1 MiB per file, and trace files are capped at 500 MiB per file.

Use repo-native commands through `nix`:

```sh
nix develop -c pnpm run dev
nix develop -c pnpm run test
nix develop -c pnpm run check
nix develop -c pnpm run wasm:build:release
nix develop -c pnpm run wasm:check
nix develop -c pnpm run wasm:test
```

Generated wasm-bindgen JavaScript, TypeScript declarations, and WASM under `packages/core/src/wasm-bindgen` are build outputs and are not committed. Package build and release commands generate them from Rust before compiling or packing the package. The application build consumes the published package and does not require a Rust toolchain.

Track backlog work in [GitHub issues](https://github.com/tomrford/cantraceviewer/issues).

### Rust

The Rust toolchain, wasm-bindgen CLI, and Binaryen are pinned by `flake.lock`. Keep CAN, DBC, and trace parsing in this crate rather than introducing format-parser dependencies. Compression implementations may use a focused, WASM-compatible crate. BLF decompression uses `fdeflate`.
