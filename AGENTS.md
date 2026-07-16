# AGENTS.md

This repo is the source for CAN Trace Viewer, a client-side CAN log plotter.

The live instance is at https://cantraceviewer.com, served entirely statically from Cloudflare workers.

The app opens directly into the plotter. Users load one CAN trace, save one or more DBC files to the local browser library, select signals from the signal selector popover, and render decoded signal series on a shared time plot.

The UI uses SvelteKit, Svelte 5, Node.js, pnpm, Tailwind, and shadcn-svelte style components. Rust code lives under `wasm/` and compiles through wasm-bindgen for DBC parsing, trace parsing, and signal decoding.

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

The repo commits the release WASM binary and generated wasm-bindgen JavaScript and TypeScript declarations for git-based deployment on Cloudflare Workers. If you change Rust code or its exported interface, run `pnpm run wasm:build:release` before committing so every generated artifact is updated.

Track backlog work in [GitHub issues](https://github.com/tomrford/cantraceviewer/issues).

### Rust

The Rust toolchain, wasm-bindgen CLI, and Binaryen are pinned by `flake.lock`. Keep CAN, DBC, and trace parsing in this crate rather than introducing format-parser dependencies. Compression implementations may use a focused, WASM-compatible crate. BLF decompression uses `fdeflate`.

