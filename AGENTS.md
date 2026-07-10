# AGENTS.md

This repo is the source for CAN Trace Viewer, a client-side CAN log inspection app.

Live instance: https://cantraceviewer.com

Product shape: open directly into the plotter. Load one ASC, PCAN TRC 1.x/2.x, or BLF trace, save one or more DBC files to the local browser library, select signals from the signal selector popover, and render decoded signal series on a shared time plot.

Implementation shape: SvelteKit/Svelte 5 with Bun, Tailwind, and shadcn-svelte style components. Rust code lives under `wasm/` and compiles through wasm-bindgen for DBC parsing, trace parsing, and signal decode work.

Keep TypeScript as the glue between the Svelte UI and generated wasm-bindgen classes. Keep WASM details behind typed browser-facing interfaces.

Saved DBC files and UI preferences live only in browser storage on the current device. Loaded traces and derived signal series live in memory for the current browser session. Do not add server persistence or new persisted state without an explicit product reason.

Enforce browser file-size caps in TypeScript before reading file contents: DBC files are capped at 1 MiB per file, and trace files are capped at 500 MiB per file.

Use repo-native commands via `nix develop`:

```sh
bun run dev
bun run test
bun run check
bun run wasm:build:release
bun run wasm:check
bun run wasm:test
```

The repo commits the release WASM binary and generated wasm-bindgen JavaScript and TypeScript declarations for git-based deployment on Cloudflare Workers. If you change Rust code or its exported interface, run `bun run wasm:build:release` before committing so every generated artifact is updated.

Backlog lives in GitHub issues on this repo.

### Rust

The Rust toolchain, wasm-bindgen CLI, and Binaryen are pinned by `flake.lock`. Keep CAN, DBC, and trace parsing in this crate rather than introducing format-parser dependencies. Compression implementations may use a focused, WASM-compatible crate; BLF zlib/DEFLATE decoding uses `miniz_oxide`.
