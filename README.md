# CAN Trace Viewer

[Open CAN Trace Viewer](https://cantraceviewer.com)

CAN Trace Viewer is a focused browser-based plotter for ASC, PCAN TRC 1.x/2.x, and BLF CAN logs. Add DBC files to decode signals and inspect them on a shared time axis. Your files stay on your device, with no upload, account, or subscription.

I built this for all those times I wanted to "just see quickly what the 3 or 4 important signals were doing". I did not want to wait minutes for a large, slow, licence-requiring automotive desktop app to open. This is the convenient alternative I wanted for most of my trace work, not another desktop-grade graphing tool.

The app is free and open source. It is a purely static site on Cloudflare Workers, so it costs me nothing to host. Feature requests are welcome, but I cannot promise to add everything. Keeping it focused is the point.

Trace files and decoded series stay in memory for the current browser session. Saved DBC files and display preferences stay in IndexedDB on the current device, so you can reuse them between sessions. Trace files can be up to 500 MiB. Each DBC file can be up to 1 MiB.

[Request a feature or report a file-size problem in GitHub issues](https://github.com/tomrford/cantraceviewer/issues).

## Development

The UI uses SvelteKit, Svelte 5, Bun, Tailwind, and shadcn-svelte style components. Rust code under `wasm/` compiles through wasm-bindgen for DBC parsing, trace parsing, and signal decoding. TypeScript wraps the generated bindings in typed browser-facing interfaces.

```sh
nix develop -c bun install
nix develop -c bun run dev
nix develop -c bun run wasm:build
```

Useful checks:

```sh
nix develop -c bun run test
nix develop -c bun run check
nix develop -c bun run wasm:check
nix develop -c bun run wasm:test
nix develop -c bun run wasm:build:release
```
