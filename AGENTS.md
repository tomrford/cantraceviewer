# AGENTS.md

This repo is a client-side CAN viewer. The UI is SvelteKit/Svelte 5 with Bun, Tailwind, and shadcn-svelte style components. Zig code lives under `wasm/` and compiles to WebAssembly for DBC/log parsing and decode work.

Current product direction: first build a DBC viewer as the learning slice. Load a DBC, decode through WASM, and render a useful one-page browser view. The fuller trace viewer comes after that: CAN log ingest, DBC decode overlays, virtualized tables, and interactive graphing.

Keep TypeScript as the glue between the Svelte UI and WASM workers. Do not make the UI depend on raw WASM pointers or allocator details; expose small typed adapters.

Do not add persistence by default. Loaded files and derived state live in memory for the current browser session.

Use repo-native commands via `nix develop`:

```sh
bun run dev
bun run test
bunx svelte-check --tsconfig ./tsconfig.json
cd wasm && zig build test
```

`bun run check` includes Wrangler type generation and may require Cloudflare worker types to be generated first.

### Zig

We are using Zig 0.16.0 for the WASM parts of the project. Docs can be found at https://ziglang.org/documentation/0.16.0/.
