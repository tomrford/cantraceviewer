# CAN Trace Viewer

[Open CAN Trace Viewer](https://cantraceviewer.com)

CAN Trace Viewer is a focused browser-based plotter for ASC, PCAN TRC 1.x/2.x, BLF, and MF4 vehicle data. Add DBC files to decode raw CAN frames, or select native measurement channels already decoded in an MF4 file. Inspect them together on a shared time axis. Your files stay on your device, with no upload, account, or subscription.

I built this for all those times I wanted to "just see quickly what the 3 or 4 important signals were doing". I did not want to wait minutes for a large, slow, licence-requiring automotive desktop app to open. This is the convenient alternative I wanted for most of my trace work, not another desktop-grade graphing tool.

The app is free and open source. It is a purely static site on Cloudflare Workers, so it costs me nothing to host. Feature requests are welcome, but I cannot promise to add everything. Keeping it focused is the point.

Trace files and decoded series stay in memory for the current browser session. Saved DBC files and display preferences stay in IndexedDB on the current device, so you can reuse them between sessions. DBC files embedded in MF4 traces are temporary and disappear with the trace. Trace files can be up to 500 MiB. Each DBC file, including an embedded DBC after decompression, can be up to 1 MiB.

[Request a feature or report a file-size problem in GitHub issues](https://github.com/tomrford/cantraceviewer/issues).

## Development

The UI uses SvelteKit, Svelte 5, Node.js, pnpm, Tailwind, and shadcn-svelte style components. Rust code under `wasm/` compiles through wasm-bindgen for DBC parsing, trace parsing, and signal decoding. The published `cantraceviewer` package exposes asynchronous browser and Node clients plus a synchronous direct entry. This app uses an exact registry version of the browser client, which runs its WASM work in a dedicated Worker.

Chrome 149+ and Edge 150+ can analyse a loaded trace through WebMCP (`document.modelContext`) when `chrome://flags/#enable-webmcp-testing` is enabled, or when an origin trial is active. HTTPS or localhost is required. Users load trace and DBC files with the visible browser controls. The page tools search and select signals, arrange up to five Y axes, set or reset the time window, place C1/C2 crosshairs and choose their legend readout. Numerical inspection reads a capped set of nearest decoded samples at explicit times or the current crosshairs without moving the plot. Use screenshots for signal shape and tool results for precise values and timestamps. Decoded sample arrays stay in the tab.

```sh
nix develop -c pnpm install
nix develop -c pnpm run dev
```

Useful checks:

```sh
nix develop -c pnpm run test
nix develop -c pnpm run check
nix develop -c pnpm run wasm:check
nix develop -c pnpm run wasm:test
nix develop -c pnpm run wasm:build:release
nix develop -c pnpm run package:validate
```
