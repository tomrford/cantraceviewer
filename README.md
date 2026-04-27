# CAN Log Viewer

Client-side CAN tooling for inspecting DBC files and, later, CAN traces. The app uses SvelteKit for the browser UI and Zig compiled to WebAssembly for decode/parsing work.

The first milestone is a DBC viewer: load a DBC in the browser, decode it through the WASM boundary, and present messages/signals in a useful one-page interface. The next milestone is trace viewing: load CAN logs, apply DBC decoding, and add interactive tables and graphing.

Data stays in the current browser session. Refreshing the page clears loaded files and derived state.

## Development

```sh
bun install
bun run dev
cd wasm && zig build
```

Useful checks:

```sh
bun run test
bunx svelte-check --tsconfig ./tsconfig.json
cd wasm && zig build test
```
