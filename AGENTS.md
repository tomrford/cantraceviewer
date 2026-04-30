# AGENTS.md

This repo is a client-side CAN viewer. The UI is SvelteKit/Svelte 5 with Bun, Tailwind, and shadcn-svelte style components. Zig code lives under `wasm/` and compiles to WebAssembly for DBC/log parsing and decode work.

Current product direction: first build a DBC viewer as the learning slice. Load a DBC, decode through WASM, and render a useful one-page browser view. The fuller trace viewer comes after that: CAN log ingest, DBC decode overlays, virtualized tables, and interactive graphing.

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

`bun run check` includes Wrangler type generation and may require Cloudflare worker types to be generated first.

Open work:

- Add a WASM benchmark harness that builds `Debug`, `ReleaseSafe`, `ReleaseFast`, and `ReleaseSmall`, records raw/gzip sizes, and separately times instantiate, DBC parse/JSON export, ASC parse, and signal-series extraction against fixed fixtures.
- If selected-signal graphing spends meaningful time rescanning traces, consider a batch decode API or per-message frame index so multiple selected signals can share one pass over matching ASC frames.
- If parsed ASC frame memory becomes a measured problem, consider compact frame storage with `Asc` owning `frames: []Frame` plus a contiguous `payloads: []u8` side buffer; data frames store payload offset/length, while remote/error/unknown events store no payload bytes.

### Zig

We are using Zig 0.16.0 for the WASM parts of the project. Docs can be found at https://ziglang.org/documentation/0.16.0/.
